import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import * as schema from '@lupin/db';
import type { ConnectorAdapter } from '@lupin/connectors-sdk';
import type { CallerResolver } from '../http/roles.js';
import { createNotificationRoutes } from '../routes/notifications.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import {
  channelWithSecret,
  createChannel,
  createSubscription,
  deleteChannel,
  deleteSubscription,
  describeCadence,
  listChannels,
  listDeliveries,
  listSubscriptions,
  loadReport,
  nextOccurrence,
  queueTestDelivery,
  slowerTests,
  updateChannel,
} from './notification-service.js';
import { createReportDispatcher, requestFor } from './report-dispatcher.js';

const VAULT = syntheticVaultSecret();
const NOW = new Date('2026-10-25T08:00:00.000Z');
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options = { db: db as never, workspaceId: 'ws-1', vaultSecret: VAULT, now: () => NOW };
  return { db, options, other: { ...options, workspaceId: 'ws-2' } };
}

const TOKEN = ['1234', ':', 'telegram-bot-secret'].join('');

describe('channels', () => {
  it('seals the credential and never returns it', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, {
      kind: 'telegram',
      name: 'QA chat',
      settings: { chatId: '-100123' },
      secret: TOKEN,
    });
    expect(JSON.stringify(channel)).not.toContain(TOKEN);
    expect(JSON.stringify(await listChannels(options))).not.toContain(TOKEN);
    expect(JSON.stringify(await db.select().from(schema.vaultEntries))).not.toContain(TOKEN);
    expect((await channelWithSecret(options, channel.id)).secret).toBe(TOKEN);
  });

  it('is invisible, unreadable and undeletable from another workspace', async () => {
    const { options, other } = await setup();
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    expect(await listChannels(other)).toEqual([]);
    await expect(channelWithSecret(other, channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteChannel(other, channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(queueTestDelivery(other, channel.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(channelWithSecret(options, 'not-a-uuid')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('edits a channel in place, keeping the secret unless a new one is sent', async () => {
    const { options, other } = await setup();
    const channel = await createChannel(options, {
      kind: 'telegram',
      name: 'QA chat',
      settings: { chatId: '-100123' },
      secret: TOKEN,
    });
    const renamed = await updateChannel(options, channel.id, {
      name: 'Release chat',
      enabled: false,
    });
    expect(renamed).toMatchObject({
      name: 'Release chat',
      enabled: false,
      settings: { chatId: '-100123' },
    });
    expect((await channelWithSecret(options, channel.id)).secret).toBe(TOKEN);
    const next = ['5678', ':', 'telegram-bot-secret-2'].join('');
    await updateChannel(options, channel.id, { secret: next });
    expect((await channelWithSecret(options, channel.id)).secret).toBe(next);
    await expect(
      updateChannel(options, channel.id, { settings: { chatId: 'nope nope' } }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
    });
    await expect(updateChannel(other, channel.id, { name: 'Mine' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an edited Teams webhook the server must not call', async () => {
    const { options } = await setup();
    const channel = await createChannel(options, {
      kind: 'teams',
      name: 't',
      settings: {},
      secret: 'https://example.webhook.office.com/hook',
    });
    await expect(
      updateChannel(options, channel.id, { secret: 'http://10.0.0.5/hook' }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
    });
  });

  it('refuses a Teams webhook the server must not call, and a Signal bridge that is not a URL', async () => {
    const { options } = await setup();
    await expect(
      createChannel(options, {
        kind: 'teams',
        name: 't',
        settings: {},
        secret: 'http://10.0.0.5/hook',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
    await expect(
      createChannel(options, {
        kind: 'signal',
        name: 's',
        settings: { number: '+15551234567', recipients: '+15557654321' },
        secret: 'ftp://signal',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
    // The bridge on the LAN is the expected shape.
    expect(
      (
        await createChannel(options, {
          kind: 'signal',
          name: 's',
          settings: { number: '+15551234567', recipients: '+15557654321' },
          secret: 'http://192.168.1.10:8081',
        })
      ).kind,
    ).toBe('signal');
  });

  it('leaves no half-made channel when the vault is not configured', async () => {
    const { options } = await setup();
    const noVault = { ...options, vaultSecret: undefined };
    await expect(
      createChannel(noVault, {
        kind: 'slack',
        name: 's',
        settings: { channel: '#qa' },
        secret: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(await listChannels(options)).toEqual([]);
  });

  it('deleting a channel removes its subscriptions, schedules and credential, and keeps history', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, {
      kind: 'slack',
      name: 's',
      settings: { channel: '#qa' },
      secret: 'xoxb-test',
    });
    const subscription = await createSubscription(options, {
      channelId: channel.id,
      name: 'Daily',
      cadence: 'daily',
      time: '09:00',
      weekday: 1,
      timezone: 'UTC',
    });
    await queueTestDelivery(options, channel.id);
    await deleteChannel(options, channel.id);
    expect(await listSubscriptions(options)).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.schedules)
        .where(eq(schema.schedules.id, `report:${subscription.id}`)),
    ).toEqual([]);
    expect(await db.select().from(schema.vaultEntries)).toEqual([]);
    expect(await listDeliveries(options)).toHaveLength(1);
  });
});

describe('subscriptions', () => {
  it('writes the report schedule the worker fires, in the subscription’s timezone, run once', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    const subscription = await createSubscription(options, {
      channelId: channel.id,
      name: 'Weekly',
      cadence: 'weekly',
      time: '09:30',
      weekday: 1,
      timezone: 'Europe/Berlin',
    });
    expect(subscription).toMatchObject({
      cronExpr: '30 9 * * 1',
      describe: 'Every Monday at 09:30',
      // Monday 26 October 2026, 09:30 in Berlin, is 08:30 UTC (CET after the clock change).
      nextRunAt: '2026-10-26T08:30:00.000Z',
    });
    const [row] = await db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.id, `report:${subscription.id}`));
    expect(row).toMatchObject({ workspaceId: 'ws-1', cronExpr: '30 9 * * 1', enabled: true });
    expect(row?.runOptions).toMatchObject({
      kind: 'report',
      subscriptionId: subscription.id,
      timezone: 'Europe/Berlin',
      misfirePolicy: 'run_once',
    });
    expect((await listSubscriptions(options))[0]?.nextRunAt).toBe('2026-10-26T08:30:00.000Z');
    expect(subscription.quietHours).toBeNull();
  });

  it('keeps quiet hours on the subscription and hands the worker its copy', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    const subscription = await createSubscription(options, {
      channelId: channel.id,
      name: 'Nightly',
      cadence: 'daily',
      time: '23:00',
      weekday: 1,
      timezone: 'Europe/Berlin',
      quietHours: { start: 22, end: 7 },
    });
    expect(subscription.quietHours).toEqual({ start: 22, end: 7 });
    expect((await listSubscriptions(options))[0]?.quietHours).toEqual({ start: 22, end: 7 });
    const [row] = await db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.id, `report:${subscription.id}`));
    expect(row?.runOptions).toMatchObject({ quietHours: { start: 22, end: 7 } });
  });

  it('defaults a subscription to the general audience and the chat format, and keeps a chosen pair', async () => {
    const { options } = await setup();
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    // Omitted: read back as the safe default, which is the report exactly as it was.
    const plain = await createSubscription(options, {
      channelId: channel.id,
      name: 'Plain',
      cadence: 'daily',
      time: '09:00',
      weekday: 1,
      timezone: 'UTC',
    });
    expect(plain).toMatchObject({ audience: 'general', format: 'chat' });
    // Chosen: persisted and returned, so the value the dispatcher's lens reads is the one set.
    const tuned = await createSubscription(options, {
      channelId: channel.id,
      name: 'Tuned',
      cadence: 'daily',
      time: '09:00',
      weekday: 1,
      timezone: 'UTC',
      audience: 'manager',
      format: 'full',
    });
    expect(tuned).toMatchObject({ audience: 'manager', format: 'full' });
    const listed = await listSubscriptions(options);
    expect(listed.map((s) => [s.name, s.audience, s.format])).toEqual(
      expect.arrayContaining([
        ['Plain', 'general', 'chat'],
        ['Tuned', 'manager', 'full'],
      ]),
    );
  });

  it('refuses a cron that does not parse, a timezone that does not exist, and another workspace’s channel', async () => {
    const { options, other } = await setup();
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    const base = {
      channelId: channel.id,
      name: 'x',
      time: '09:00',
      weekday: 1,
      timezone: 'UTC',
    } as const;
    await expect(
      createSubscription(options, { ...base, cadence: 'custom', cronExpr: 'every day please' }),
    ).rejects.toMatchObject({ code: 'INVALID_SCHEDULE' });
    await expect(
      createSubscription(options, { ...base, cadence: 'daily', timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({ code: 'INVALID_SCHEDULE' });
    await expect(createSubscription(other, { ...base, cadence: 'daily' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps the project a report is about, and refuses one that is not this workspace’s', async () => {
    const { db, options, other } = await setup();
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    const [mine, theirs] = await db
      .insert(schema.projects)
      .values([
        { workspaceId: 'ws-1', name: 'Mine', slug: 'mine', defaultBranch: 'main' },
        { workspaceId: 'ws-2', name: 'Theirs', slug: 'theirs', defaultBranch: 'main' },
      ])
      .returning({ id: schema.projects.id });
    const base = {
      channelId: channel.id,
      name: 'x',
      cadence: 'daily',
      time: '09:00',
      weekday: 1,
      timezone: 'UTC',
    } as const;
    const withProject = await createSubscription(options, {
      ...base,
      projectId: (mine as { id: string }).id,
    });
    expect(withProject.projectId).toBe((mine as { id: string }).id);
    expect((await createSubscription(options, base)).projectId).toBeNull();
    expect((await listSubscriptions(options)).map((entry) => entry.projectId)).toEqual([
      (mine as { id: string }).id,
      null,
    ]);
    await expect(
      createSubscription(options, { ...base, projectId: (theirs as { id: string }).id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createSubscription(options, { ...base, projectId: '00000000-0000-4000-8000-0000000000aa' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(other.workspaceId).toBe('ws-2');
  });

  it('deletes its schedule with it, and only in its own workspace', async () => {
    const { db, options, other } = await setup();
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    const subscription = await createSubscription(options, {
      channelId: channel.id,
      name: 'Daily',
      cadence: 'daily',
      time: '07:00',
      weekday: 1,
      timezone: 'UTC',
    });
    await expect(deleteSubscription(other, subscription.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(deleteSubscription(options, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await deleteSubscription(options, subscription.id);
    expect(await db.select().from(schema.schedules)).toEqual([]);
  });
});

describe('describing a cadence and finding the next run', () => {
  it('says it in words where it can', () => {
    expect(describeCadence('daily', '0 9 * * *')).toBe('Every day at 09:00');
    expect(describeCadence('custom', '15 8 * * 1-5')).toBe('Weekdays at 08:15');
    expect(describeCadence('weekly', '0 17 * * 5')).toBe('Every Friday at 17:00');
    expect(describeCadence('custom', '*/30 * * * *')).toBe('Custom: */30 * * * *');
    expect(describeCadence('daily', '0 9 1 * *')).toBe('0 9 1 * *');
  });

  it('refuses a schedule that never fires', () => {
    expect(() => nextOccurrence('0 0 30 2 *', 'UTC', NOW)).toThrow(/never fires|cron/u);
  });
});

async function seedRuns(
  db: MigratedDb,
  statuses: Array<'passed' | 'failed' | 'running'>,
  at: Date,
) {
  for (const [index, status] of statuses.entries()) {
    await db.insert(schema.runs).values({
      workspaceId: 'ws-1',
      startedAt: new Date(at.getTime() - (index + 1) * 60_000),
      status,
      suite: status === 'failed' ? 'checkout e2e' : 'smoke',
    });
  }
}

describe('slowerTests', () => {
  const durations = (entries: Record<string, number[]>) =>
    new Map(Object.entries(entries).map(([key, ms]) => [key, { title: key, ms }]));

  it('names a test whose median grew past both floors, worst first', () => {
    expect(
      slowerTests(
        durations({ a: [400, 400, 400], b: [300, 300, 300], c: [10, 10, 10, 12] }),
        durations({ a: [100, 100, 100], b: [200, 200, 200], c: [4, 4, 4, 4] }),
      ),
    ).toEqual([
      { key: 'a', title: 'a', changePct: 300 },
      { key: 'b', title: 'b', changePct: 50 },
    ]);
  });

  it('says nothing with too few runs on either side, under 50ms, or with no earlier window', () => {
    expect(
      slowerTests(
        durations({ few: [900, 900], tiny: [130, 130, 130], fresh: [900, 900, 900] }),
        durations({ few: [100, 100, 100], tiny: [100, 100, 100] }),
      ),
    ).toEqual([]);
  });
});

describe('what a report says', () => {
  it('counts the window’s runs, its pass rate, and the suites that failed', async () => {
    const { db, options } = await setup();
    await seedRuns(db, ['passed', 'passed', 'failed', 'failed', 'running'], NOW);
    const report = await loadReport(options, { title: 'Daily', windowDays: 1, link: null });
    expect(report).toMatchObject({
      runs: 5,
      passRate: 50,
      attention: [{ severity: 'bad', text: 'checkout e2e failed 2 times' }],
    });
    const single = await (async () => {
      const fresh = await setup();
      await seedRuns(fresh.db, ['failed'], NOW);
      return loadReport(fresh.options, { title: 'Daily', windowDays: 1, link: null });
    })();
    expect(single.attention).toEqual([{ severity: 'bad', text: 'checkout e2e failed' }]);
  });

  it('never counts another workspace’s runs', async () => {
    const { db, other } = await setup();
    await seedRuns(db, ['failed', 'failed'], NOW);
    expect(await loadReport(other, { title: 'Daily', windowDays: 1, link: null })).toMatchObject({
      runs: 0,
      passRate: null,
      attention: [],
    });
  });

  it('says which tests turned flaky, started failing, got fixed and slowed, against the window before', async () => {
    const { db, options } = await setup();
    const DAY = 86_400_000;
    const run = async (workspaceId: string, at: Date) => {
      const [row] = await db
        .insert(schema.runs)
        .values({ workspaceId, startedAt: at, status: 'passed', suite: 'unit' })
        .returning({ id: schema.runs.id });
      return (row as { id: string }).id;
    };
    const test = (
      runId: string,
      stableId: string,
      status: string,
      durationMs = 100,
      workspaceId = 'ws-1',
    ) =>
      db.insert(schema.tests).values({
        id: `${runId}:${stableId}`,
        runId,
        workspaceId,
        title: stableId,
        file: 'a.test.ts',
        stableId,
        status: status as never,
        durationMs,
      });
    // The window before: `old-flaky` flipped, `cart` and `pay` ran green at 100ms.
    for (let index = 0; index < 3; index += 1) {
      const before = await run('ws-1', new Date(NOW.getTime() - DAY - (index + 1) * 60_000));
      await test(before, 'old-flaky', index === 0 ? 'flaky' : 'passed');
      await test(before, 'cart', 'passed', 100);
      await test(before, 'search', 'passed', 100);
      await test(before, 'pay', 'passed');
    }
    // This window: `cart` turned flaky, `search` slowed to 400ms, `pay` started failing, `old-flaky` held.
    for (let index = 0; index < 3; index += 1) {
      const now = await run('ws-1', new Date(NOW.getTime() - (index + 1) * 60_000));
      await test(now, 'old-flaky', 'passed');
      await test(now, 'cart', index === 0 ? 'flaky' : 'passed', 400);
      await test(now, 'search', 'passed', 400);
      await test(now, 'pay', index === 0 ? 'failed' : 'passed');
    }
    // Another workspace's flaky test is never this workspace's news.
    const foreign = await run('ws-2', new Date(NOW.getTime() - 60_000));
    await test(foreign, 'theirs', 'flaky', 100, 'ws-2');

    const report = await loadReport(options, { title: 'Daily', windowDays: 1, link: null });
    expect(report.digest.map((item) => [item.kind, item.tone, item.text])).toEqual(
      expect.arrayContaining([
        ['new-flaky', 'bad', '1 new flaky test'],
        ['new-failure', 'bad', '1 newly failing test'],
        ['new-flaky', 'good', '1 flaky test fixed'],
        ['newly-slow', 'bad', 'search is 300% slower'],
      ]),
    );
  });
});

function fakeAdapter(results: Array<{ ok: boolean; retryable?: boolean; code?: string }>) {
  const calls: Array<{ operation: string; input: unknown; secret: string }> = [];
  let index = 0;
  const adapter: ConnectorAdapter = {
    manifest: { name: 'fake', version: '1', operations: {} },
    execute: vi.fn(async (request, secret) => {
      calls.push({ operation: request.operation, input: request.input, secret });
      const next = results[Math.min(index, results.length - 1)] ?? { ok: true };
      index += 1;
      return next.ok
        ? { status: 'ok' as const, attempts: 1 }
        : {
            status: 'error' as const,
            attempts: 1,
            error: {
              code: next.code ?? 'fake_error',
              retryable: next.retryable ?? false,
              message: 'x',
            },
          };
    }),
  };
  return { adapter, calls };
}

describe('the dispatcher', () => {
  it('delivers a scheduled report to the inbox, rendered, and a second poll finds nothing', async () => {
    const { db, options } = await setup();
    await seedRuns(db, ['passed', 'failed'], NOW);
    const channel = await createChannel(options, { kind: 'inbox', name: 'Inbox', settings: {} });
    const subscription = await createSubscription(options, {
      channelId: channel.id,
      name: 'Daily quality report',
      cadence: 'daily',
      time: '09:00',
      weekday: 1,
      timezone: 'UTC',
    });
    await db.insert(schema.reportDeliveries).values({
      workspaceId: 'ws-1',
      subscriptionId: subscription.id,
      idempotencyKey: `schedule:report:${subscription.id}:2026-10-25T07:00:00.000Z`,
      scheduledFor: new Date('2026-10-25T07:00:00.000Z'),
      nextAttemptAt: new Date('2026-10-25T07:00:00.000Z'),
    });
    const dispatcher = createReportDispatcher({
      db: db as never,
      vaultSecret: VAULT,
      adapters: {},
      link: 'https://lupin.local/dashboard/now',
      now: () => NOW,
    });
    expect(await dispatcher.runOnce()).toMatchObject([{ status: 'sent', errorCode: null }]);
    expect(await dispatcher.runOnce()).toEqual([]);
    const [delivery] = await listDeliveries(options);
    expect(delivery?.status).toBe('sent');
    expect(delivery?.rendered).toContain('🔴 Daily quality report');
    expect(delivery?.rendered).toContain('50% passed across 2 runs.');
    expect(delivery?.rendered).toContain('https://lupin.local/dashboard/now');
  });

  it('sends a test to Telegram with the opened token, as HTML', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, {
      kind: 'telegram',
      name: 'QA',
      settings: { chatId: '-100123' },
      secret: TOKEN,
    });
    await queueTestDelivery(options, channel.id);
    const { adapter, calls } = fakeAdapter([{ ok: true }]);
    const dispatcher = createReportDispatcher({
      db: db as never,
      vaultSecret: VAULT,
      adapters: { telegram: adapter },
      link: null,
      now: () => NOW,
    });
    expect(await dispatcher.runOnce()).toMatchObject([{ status: 'sent' }]);
    expect(calls[0]).toMatchObject({ operation: 'sendMessage', secret: TOKEN });
    expect((calls[0]?.input as { text: string }).text).toMatch(
      /^<b>🟢 Test report from Lupin<\/b>/u,
    );
  });

  it('retries a retryable failure with backoff, then gives up with the adapter’s code', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, {
      kind: 'slack',
      name: 'QA',
      settings: { channel: '#qa' },
      secret: 'xoxb-test',
    });
    await queueTestDelivery(options, channel.id);
    const { adapter, calls } = fakeAdapter([
      { ok: false, retryable: true, code: 'slack_rejected_429' },
    ]);
    let clock = NOW;
    const dispatcher = createReportDispatcher({
      db: db as never,
      vaultSecret: VAULT,
      adapters: { slack: adapter },
      link: null,
      now: () => clock,
      maxAttempts: 2,
    });
    expect(await dispatcher.runOnce()).toMatchObject([
      { status: 'pending', errorCode: 'slack_rejected_429' },
    ]);
    // Backing off: not due again yet.
    expect(await dispatcher.runOnce()).toEqual([]);
    clock = new Date(NOW.getTime() + 2 * 60_000);
    expect(await dispatcher.runOnce()).toMatchObject([
      { status: 'failed', errorCode: 'slack_rejected_429' },
    ]);
    expect(calls).toHaveLength(2);
    expect((await listDeliveries(options))[0]).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('two dispatchers polling together send one message', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, {
      kind: 'slack',
      name: 'QA',
      settings: { channel: '#qa' },
      secret: 'xoxb-test',
    });
    await queueTestDelivery(options, channel.id);
    const { adapter, calls } = fakeAdapter([{ ok: true }]);
    const make = () =>
      createReportDispatcher({
        db: db as never,
        vaultSecret: VAULT,
        adapters: { slack: adapter },
        link: null,
        now: () => NOW,
      });
    const [first, second] = await Promise.all([make().runOnce(), make().runOnce()]);
    expect([...first, ...second]).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('fails visibly when the channel has no adapter, is gone, or was never named', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, {
      kind: 'teams',
      name: 'QA',
      settings: {},
      secret: 'https://example.logic.azure.com/workflows/x',
    });
    await queueTestDelivery(options, channel.id);
    const gone = await createChannel(options, { kind: 'inbox', name: 'Gone', settings: {} });
    await queueTestDelivery(options, gone.id);
    await db.delete(schema.notificationChannels).where(eq(schema.notificationChannels.id, gone.id));
    await db.insert(schema.reportDeliveries).values({
      workspaceId: 'ws-1',
      idempotencyKey: 'orphan',
      scheduledFor: NOW,
      nextAttemptAt: NOW,
    });
    const logged: unknown[] = [];
    const dispatcher = createReportDispatcher({
      db: db as never,
      vaultSecret: VAULT,
      adapters: {},
      link: null,
      now: () => NOW,
      log: (_message, details) => logged.push(details),
    });
    const outcomes = await dispatcher.runOnce();
    expect(outcomes.map((outcome) => outcome.errorCode).sort()).toEqual([
      'channel_missing',
      'channel_missing',
      'teams_not_configured',
    ]);
    expect(logged).toHaveLength(3);
  });

  it('names a vault that will not open, rather than leaving the row in sending', async () => {
    const { db, options } = await setup();
    const channel = await createChannel(options, {
      kind: 'slack',
      name: 'QA',
      settings: { channel: '#qa' },
      secret: 'xoxb-test',
    });
    await queueTestDelivery(options, channel.id);
    const { adapter } = fakeAdapter([{ ok: true }]);
    const dispatcher = createReportDispatcher({
      db: db as never,
      vaultSecret: undefined,
      adapters: { slack: adapter },
      link: null,
      now: () => NOW,
    });
    expect(await dispatcher.runOnce()).toMatchObject([
      { status: 'failed', errorCode: 'delivery_not_configured' },
    ]);
  });

  it('starts, keeps polling, and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      const { db } = await setup();
      const log = vi.fn();
      // Each poll of an empty queue is one claim statement: counting them counts the polls.
      let claims = 0;
      const counted = new Proxy(db, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (property !== 'execute' || typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            claims += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const dispatcher = createReportDispatcher({
        db: counted as never,
        vaultSecret: VAULT,
        adapters: {},
        link: null,
        log,
      });
      dispatcher.start(1_000);
      // A second start is the same loop, not a second one polling beside it.
      dispatcher.start(1_000);
      await vi.advanceTimersByTimeAsync(2_500);
      await dispatcher.stop();
      expect(claims).toBe(2);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(claims).toBe(2);
      expect(log).not.toHaveBeenCalledWith('report dispatch failed', expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('each channel gets its own rendering', () => {
  const model = {
    status: 'good' as const,
    emoji: '🟢',
    title: 'Daily',
    sentence: '3 runs in this period.',
    items: [],
    more: 0,
    areas: [],
    actions: [],
    cockpit: null,
    briefing: null,
    link: null,
  };
  const channel = (kind: string, settings: Record<string, string> = {}) => ({
    id: 'c',
    kind: kind as never,
    name: 'n',
    settings,
    enabled: true,
    createdAt: NOW.toISOString(),
  });

  it('maps every kind to its adapter operation', () => {
    expect(requestFor(channel('inbox'), model).request).toBeNull();
    expect(requestFor(channel('slack', { channel: '#qa' }), model).request).toMatchObject({
      operation: 'postMessage',
      input: { channel: '#qa', text: '*🟢 Daily*\n3 runs in this period.' },
    });
    expect(requestFor(channel('teams'), model).request?.operation).toBe('postCard');
    expect(requestFor(channel('telegram', { chatId: '1' }), model).request?.operation).toBe(
      'sendMessage',
    );
    // WhatsApp template parameters cannot hold a newline.
    const whatsapp = requestFor(
      channel('whatsapp', { phoneNumberId: '1', to: '2', template: 't', language: 'en' }),
      model,
    );
    expect((whatsapp.request?.input as { text: string }).text).toBe(
      '🟢 Daily · 3 runs in this period.',
    );
    expect(
      requestFor(channel('signal', { number: '+1', recipients: '+2' }), model).request?.operation,
    ).toBe('send');
    // Email: the digest as text, with the full report's HTML as the alternative only when a
    // full-format render is supplied; the settings carry from/to/subject.
    const emailChat = requestFor(
      channel('email', { from: 'a@x', to: 'b@x', subject: 'Report' }),
      model,
    );
    expect(emailChat.request).toMatchObject({
      operation: 'send',
      input: { from: 'a@x', to: 'b@x', subject: 'Report', text: expect.stringContaining('Daily') },
    });
    expect(emailChat.request?.input).not.toHaveProperty('html');
    const emailFull = requestFor(
      channel('email', { from: 'a@x', to: 'b@x', subject: 'Report' }),
      model,
      null,
      '<!doctype html><html><body>full</body></html>',
    );
    expect((emailFull.request?.input as { html: string }).html).toContain('<!doctype html>');
  });
});

describe('the notification routes', () => {
  async function routes(role: 'viewer' | 'operator' | 'admin') {
    const { db, options } = await setup();
    const access: CallerResolver = {
      mode: 'enforced',
      authenticateToken: async () => ({ actor: `token:${role}`, role, uploaderFor: null }),
      hasSession: async () => false,
    };
    const dispatchNow = vi.fn(async () => []);
    const app: Hono = withErrorBoundary(
      createNotificationRoutes({ ...options, access, link: null, dispatchNow }),
    );
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { authorization: 'Bearer lup_x', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { db, options, call, dispatchNow };
  }

  it('lets a viewer read and refuses them the channel and the schedule', async () => {
    const { call } = await routes('viewer');
    expect((await call('GET', '/api/v1/notification-channels')).status).toBe(200);
    expect((await call('GET', '/api/v1/report-deliveries')).status).toBe(200);
    expect((await call('GET', '/api/v1/report-subscriptions')).status).toBe(200);
    const preview = await call('GET', '/api/v1/report-preview?window=daily');
    expect(await preview.json()).toMatchObject({
      status: 'good',
      text: expect.stringContaining('Daily quality report'),
    });
    expect((await call('GET', '/api/v1/report-preview')).status).toBe(200);
    // The preview reflects the chosen lens: an audience query is accepted and composed.
    expect(
      (await call('GET', '/api/v1/report-preview?window=weekly&audience=manager')).status,
    ).toBe(200);
    // The full report as HTML: viewer-gated, self-contained, and lensable by query.
    const full = await call('GET', '/api/v1/report.html?window=daily');
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toContain('text/html');
    expect(full.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await full.text();
    expect(html).toContain('Daily quality report');
    const download = await call(
      'GET',
      '/api/v1/report.html?window=weekly&audience=manager&download=1',
    );
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain(
      'attachment; filename="lupin-report-',
    );
    expect(
      (await call('POST', '/api/v1/notification-channels', { kind: 'inbox', name: 'x' })).status,
    ).toBe(403);
    expect((await call('POST', '/api/v1/report-subscriptions', {})).status).toBe(403);
  });

  it('lets an admin add a channel, test it, and remove it; an operator schedule it', async () => {
    const admin = await routes('admin');
    const created = await admin.call('POST', '/api/v1/notification-channels', {
      kind: 'slack',
      name: 'QA',
      settings: { channel: '#qa' },
      secret: 'xoxb-route-secret',
    });
    expect(created.status).toBe(201);
    const channel = (await created.json()) as { id: string };
    expect(JSON.stringify(channel)).not.toContain('xoxb-route-secret');
    expect(
      (await admin.call('POST', '/api/v1/notification-channels', { kind: 'slack' })).status,
    ).toBe(400);
    const tested = await admin.call('POST', `/api/v1/notification-channels/${channel.id}/test`);
    expect(tested.status).toBe(202);
    expect(admin.dispatchNow).toHaveBeenCalledOnce();
    expect(await tested.json()).toMatchObject({ delivery: { status: 'pending' } });

    const subscribed = await admin.call('POST', '/api/v1/report-subscriptions', {
      channelId: channel.id,
      cadence: 'daily',
    });
    expect(subscribed.status).toBe(201);
    const subscription = (await subscribed.json()) as { id: string; describe: string };
    expect(subscription.describe).toBe('Every day at 09:00');
    expect(
      (await admin.call('POST', '/api/v1/report-subscriptions', { cadence: 'daily' })).status,
    ).toBe(400);
    expect(
      (await admin.call('DELETE', `/api/v1/report-subscriptions/${subscription.id}`)).status,
    ).toBe(200);
    expect((await admin.call('DELETE', `/api/v1/notification-channels/${channel.id}`)).status).toBe(
      200,
    );
  });
});
