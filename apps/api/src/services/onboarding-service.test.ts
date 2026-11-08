import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@lupin/db';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  dismissOnboardingStep,
  readOnboarding,
  type OnboardingOptions,
} from './onboarding-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup(ai = false) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options: OnboardingOptions = {
    db: db as never,
    workspaceId: 'ws-1',
    aiConfigured: async () => ai,
  };
  return { db, options, other: { ...options, workspaceId: 'ws-2' } };
}

async function addProject(db: MigratedDb, workspaceId: string): Promise<string> {
  const [row] = await db
    .insert(schema.projects)
    .values({ workspaceId, name: 'Shop', slug: 'shop', repoPath: '/repo' } as never)
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

const stateOf = (onboarding: Awaited<ReturnType<typeof readOnboarding>>, id: string) =>
  onboarding.steps.find((step) => step.id === id)?.state;

describe('onboarding', () => {
  it('reports 1 of 6 on a fresh install, and 2 of 6 once a repository is connected', async () => {
    const { db, options } = await setup();
    const fresh = await readOnboarding(options);
    expect(fresh).toMatchObject({ done: 1, total: 6, dismissed: false });
    expect(fresh.steps.map((step) => step.id)).toEqual([
      'workspace',
      'repository',
      'ai',
      'notifications',
      'teammates',
      'first-run',
    ]);
    await addProject(db, 'ws-1');
    expect((await readOnboarding(options)).done).toBe(2);
  });

  it('derives each step from real data: AI, a channel, a teammate, a run', async () => {
    const { db, options } = await setup(true);
    const projectId = await addProject(db, 'ws-1');
    await db
      .insert(schema.notificationChannels)
      .values({ workspaceId: 'ws-1', kind: 'inbox', name: 'Inbox' });
    const [user] = await db
      .insert(schema.users)
      .values({
        email: 'ann@acme.test',
        displayName: 'Ann',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      .returning({ id: schema.users.id });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: 'ws-1', userId: (user as { id: string }).id, role: 'viewer' });
    await db
      .insert(schema.runs)
      .values({ workspaceId: 'ws-1', projectId, startedAt: new Date(), status: 'passed' } as never);
    const onboarding = await readOnboarding(options);
    expect(onboarding.done).toBe(6);
    expect(onboarding.steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('names who can finish each step and where', async () => {
    const { options } = await setup();
    const { steps } = await readOnboarding(options);
    expect(steps.find((step) => step.id === 'repository')).toMatchObject({
      who: 'operator',
      href: expect.stringContaining('/settings/projects'),
    });
    expect(steps.find((step) => step.id === 'ai')).toMatchObject({
      who: 'admin',
      href: expect.stringContaining('/settings/ai'),
    });
  });

  it('remembers a skipped step and the dismissed checklist, per workspace', async () => {
    const { options, other } = await setup();
    await dismissOnboardingStep(options, 'ai', 'alice');
    expect(stateOf(await readOnboarding(options), 'ai')).toBe('skipped');
    await dismissOnboardingStep(options, 'checklist', 'alice');
    expect((await readOnboarding(options)).dismissed).toBe(true);
    // Twice is the same as once.
    await dismissOnboardingStep(options, 'ai', 'alice');
    expect(stateOf(await readOnboarding(other), 'ai')).toBe('todo');
    expect((await readOnboarding(other)).dismissed).toBe(false);
  });

  it('does not count another workspace project, channel or run', async () => {
    const { db, options, other } = await setup();
    await addProject(db, 'ws-2');
    await db
      .insert(schema.notificationChannels)
      .values({ workspaceId: 'ws-2', kind: 'inbox', name: 'Inbox' });
    expect((await readOnboarding(options)).done).toBe(1);
    expect((await readOnboarding(other)).done).toBe(3);
  });

  it('lets a done step stay done even after it was skipped', async () => {
    const { db, options } = await setup();
    await dismissOnboardingStep(options, 'repository', 'alice');
    await addProject(db, 'ws-1');
    expect(stateOf(await readOnboarding(options), 'repository')).toBe('done');
  });

  it('refuses an unknown step', async () => {
    const { options } = await setup();
    await expect(dismissOnboardingStep(options, 'nope', 'alice')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
