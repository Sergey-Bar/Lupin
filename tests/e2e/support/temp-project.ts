import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE } from './config.js';

/**
 * A repository a spec registers for itself, in a folder of its own, and removes again.
 *
 * Removed **as a project** before its folder goes: a project left behind with no folder is the
 * newest project in the install, and the pages that open on the newest project (Overview, the
 * repo map) then fail on a path that no longer exists — which is how three unrelated specs went
 * red the first time the release journeys ran in one suite.
 */
export interface TempProject {
  id: string;
  name: string;
  folder: string;
  /** With the caller's own request context: Playwright refuses one carried over from a hook. */
  remove(request: APIRequestContext): Promise<void>;
}

const headers = { ...API_AUTH_HEADERS, 'content-type': 'application/json' };

export async function registerTempProject(
  request: APIRequestContext,
  prefix: string,
  manifest: Record<string, unknown> = { scripts: { test: 'vitest run' } },
): Promise<TempProject> {
  const folder = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const name = path.basename(folder).toLowerCase();
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, ...manifest }));
  const created = await request.post(`${API_BASE}/api/v1/projects`, {
    headers,
    data: { name, slug: name, repoPath: folder },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { project: { id: string } }).project.id;
  return {
    id,
    name,
    folder,
    remove: async (current) => {
      await removeProject(current, id, name);
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** Deletes a project the way Settings does, by typing its name. */
export async function removeProject(
  request: APIRequestContext,
  id: string,
  name: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE}/api/v1/projects/${id}`, {
    headers,
    data: { confirm: name },
  });
  expect([200, 204, 404], `DELETE project ${name}: ${await response.text()}`).toContain(
    response.status(),
  );
}
