import { afterEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as schema from '@lupin/db';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { readGitToken } from '../services/git-credential-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  syntheticGithubToken,
  syntheticVaultSecret,
} from '../test-support/synthetic-credentials.js';
import { createProjectAdminRoutes } from './project-admin.js';

const VAULT = syntheticVaultSecret();
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ROLES: Record<string, Caller> = {
  viewer: { actor: 'token:v', role: 'viewer', uploaderFor: null },
  operator: { actor: 'token:o', role: 'operator', uploaderFor: null },
  admin: { actor: 'token:a', role: 'admin', uploaderFor: null },
};

async function project(db: MigratedDb, workspaceId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(schema.projects)
    .values({ workspaceId, name, slug: name.toLowerCase(), repoPath: `/repo/${name}` } as never)
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => ROLES[token] ?? null,
    hasSession: async () => false,
  };
  const options = { db: db as never, vaultSecret: VAULT, access };
  const app: Hono = withErrorBoundary(
    createProjectAdminRoutes({ ...options, workspaceId: 'ws-1' }),
  );
  const other: Hono = withErrorBoundary(
    createProjectAdminRoutes({ ...options, workspaceId: 'ws-2' }),
  );
  const call = (target: Hono, role: string, method: string, path: string, body?: unknown) =>
    target.request(path, {
      method,
      headers: { authorization: `Bearer ${role}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { db, app, other, call };
}

describe('project administration', () => {
  it('renames a project and changes its default branch, as an operator', async () => {
    const { db, app, call } = await setup();
    const id = await project(db, 'ws-1', 'Shop');
    expect(
      (await call(app, 'viewer', 'PATCH', `/api/v1/projects/${id}`, { name: 'Store' })).status,
    ).toBe(403);
    const response = await call(app, 'operator', 'PATCH', `/api/v1/projects/${id}`, {
      name: 'Store',
      defaultBranch: 'trunk',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: { id, name: 'Store' } });
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    expect(row).toMatchObject({ name: 'Store', defaultBranch: 'trunk' });
  });

  it('refuses an empty rename', async () => {
    const { db, app, call } = await setup();
    const id = await project(db, 'ws-1', 'Shop');
    expect((await call(app, 'operator', 'PATCH', `/api/v1/projects/${id}`, {})).status).toBe(400);
    expect(
      (await call(app, 'operator', 'PATCH', `/api/v1/projects/${id}`, { name: '' })).status,
    ).toBe(400);
  });

  it('deletes a project and its token, only as an admin, and only with its name typed back', async () => {
    const { db, app, call } = await setup();
    const id = await project(db, 'ws-1', 'Shop');
    await call(app, 'admin', 'PUT', `/api/v1/projects/${id}/git-token`, {
      token: syntheticGithubToken(),
    });
    expect(
      (await call(app, 'operator', 'DELETE', `/api/v1/projects/${id}`, { confirm: 'Shop' })).status,
    ).toBe(403);
    const wrong = await call(app, 'admin', 'DELETE', `/api/v1/projects/${id}`, {
      confirm: 'shop!',
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({
      error: { details: { fix: expect.stringContaining('Shop') } },
    });
    expect(
      (await call(app, 'admin', 'DELETE', `/api/v1/projects/${id}`, { confirm: 'Shop' })).status,
    ).toBe(200);
    expect(await db.select().from(schema.projects)).toHaveLength(0);
    expect(await db.select().from(schema.vaultEntries)).toHaveLength(0);
    const audit = await db.select().from(schema.auditEvents);
    expect(audit.some((row) => row.action === 'project.delete')).toBe(true);
  });

  it('replaces and removes a git token, never echoing it', async () => {
    const { db, app, call } = await setup();
    const id = await project(db, 'ws-1', 'Shop');
    const token = syntheticGithubToken();
    expect(
      (await call(app, 'operator', 'PUT', `/api/v1/projects/${id}/git-token`, { token })).status,
    ).toBe(403);
    const put = await call(app, 'admin', 'PUT', `/api/v1/projects/${id}/git-token`, { token });
    const text = await put.text();
    expect(put.status).toBe(200);
    expect(text).not.toContain(token);
    expect(JSON.parse(text)).toEqual({ set: true });
    expect(
      await readGitToken({ db: db as never, workspaceId: 'ws-1', vaultSecret: VAULT }, id),
    ).toBe(token);
    expect(
      await (await call(app, 'operator', 'GET', `/api/v1/projects/${id}/git-token`)).json(),
    ).toEqual({ set: true });
    expect(
      await (await call(app, 'admin', 'DELETE', `/api/v1/projects/${id}/git-token`)).json(),
    ).toEqual({ set: false });
    expect(await db.select().from(schema.vaultEntries)).toHaveLength(0);
  });

  it('cannot see, rename, retoken or delete another workspace project', async () => {
    const { db, other, call } = await setup();
    const id = await project(db, 'ws-1', 'Shop');
    expect(
      (await call(other, 'admin', 'PATCH', `/api/v1/projects/${id}`, { name: 'Mine' })).status,
    ).toBe(404);
    expect(
      (await call(other, 'admin', 'PUT', `/api/v1/projects/${id}/git-token`, { token: 'x' }))
        .status,
    ).toBe(404);
    expect((await call(other, 'admin', 'GET', `/api/v1/projects/${id}/git-token`)).status).toBe(
      404,
    );
    expect(
      (await call(other, 'admin', 'DELETE', `/api/v1/projects/${id}`, { confirm: 'Shop' })).status,
    ).toBe(404);
    expect(await db.select().from(schema.projects)).toHaveLength(1);
  });
});
