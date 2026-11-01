import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@lupin/db';
import type { ConnectorAdapter, ConnectorRequest, ConnectorResult } from '@lupin/connectors-sdk';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import { loadCockpitDigest } from './cockpit-digest.js';
import { createChannel, queueTestDelivery } from './notification-service.js';
import { createReportDispatcher } from './report-dispatcher.js';

/**
 * The scheduled report with the cockpit at its head and a chart beside it.
 *
 * The adapters are fakes that answer from a script, so what is asserted is what the dispatcher
 * asks of each platform, and what it does when a platform refuses the picture.
 */
const VAULT = syntheticVaultSecret();
const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const TOKEN = ['1234', ':', 'telegram-bot-secret'].join('');
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options = { db: db as never, workspaceId: 'ws-1', vaultSecret: VAULT, now: () => NOW };
  return { db, options };
}

/** A project whose score fell from 80 to 74 on a merged pull request, with a week of coverage. */
async function seedCockpit(db: MigratedDb, workspaceId = 'ws-1') {
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      name: 'Service',
      slug: `service-${workspaceId}`,
      defaultBranch: 'main',
      repositoryUrl: 'https://github.com/octo/service',
    })
    .returning({ id: schema.projects.id });
  const projectId = (project as { id: string }).id;
  await db.insert(schema.healthSnapshots).values([
    {
      workspaceId,
      projectId,
      branch: 'main',
      takenAt: daysAgo(8),
      score: 80,
      letter: 'B',
      grade: {},
      formulaVersion: 1,
    },
    {
      workspaceId,
      projectId,
      branch: 'main',
      takenAt: daysAgo(2),
      score: 74,
      letter: 'C',
      grade: {},
      formulaVersion: 1,
      commitSha: 'a'.repeat(40),
    },
  ]);
  await db.insert(schema.scanSnapshots).values([
    {
      workspaceId,
      projectId,
      hour: daysAgo(8),
      takenAt: daysAgo(8),
      coverage: 70,
      maturity: 50,
      flakyTests: 2,
    },
    {
      workspaceId,
      projectId,
      hour: daysAgo(1),
      takenAt: daysAgo(1),
      coverage: 60,
      maturity: 50,
      flakyTests: 5,
    },
  ]);
  await db.insert(schema.pullRequests).values({
    workspaceId,
    projectId,
    externalId: '42',
    number: 42,
    state: 'merged',
    baseBranch: 'main',
    title: 'Rewrite the cache',
    openedAt: daysAgo(4),
    mergedAt: daysAgo(2),
    mergeCommitSha: 'a'.repeat(40),
    lastActivityAt: daysAgo(2),
    additions: 40,
    deletions: 10,
  });
  return projectId;
}

type Call = { request: ConnectorRequest; secret: string };

function scripted(replies: ConnectorResult[]): { adapter: ConnectorAdapter; calls: Call[] } {
  const calls: Call[] = [];
  const adapter: ConnectorAdapter = {
    manifest: { name: 'fake', version: '1', operations: {} },
    execute: async (request, secret) => {
      calls.push({ request, secret });
      return replies[Math.min(calls.length - 1, replies.length - 1)] as ConnectorResult;
    },
  };
  return { adapter, calls };
}

const ok: ConnectorResult = { status: 'ok', attempts: 1 };
const refused = (code: string, retryable = false): ConnectorResult => ({
  status: 'error',
  error: { code, retryable, message: 'refused' },
  attempts: 1,
});

async function deliverTo(
  db: MigratedDb,
  options: Awaited<ReturnType<typeof setup>>['options'],
  channel: Parameters<typeof createChannel>[1],
  adapters: Parameters<typeof createReportDispatcher>[0]['adapters'],
) {
  const created = await createChannel(options, channel);
  await queueTestDelivery(options, created.id);
  const log = vi.fn();
  const dispatcher = createReportDispatcher({
    db: db as never,
    vaultSecret: VAULT,
    adapters,
    link: null,
    now: () => NOW,
    log,
  });
  const outcomes = await dispatcher.runOnce();
  return { outcomes, log };
}

const telegram = {
  kind: 'telegram' as const,
  name: 'QA',
  settings: { chatId: '-100123' },
  secret: TOKEN,
};

describe('the report with the cockpit', () => {
  it('sends Telegram the chart with the cockpit’s headline as its caption', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const { adapter, calls } = scripted([ok]);
    const { outcomes } = await deliverTo(db, options, telegram, { telegram: adapter });
    expect(outcomes).toMatchObject([{ status: 'sent', errorCode: null }]);
    expect(calls).toHaveLength(1);
    const input = calls[0]?.request.input as {
      chatId: string;
      caption: string;
      photoBase64: string;
    };
    expect(calls[0]?.request.operation).toBe('sendPhoto');
    expect(input.chatId).toBe('-100123');
    expect(input.caption.length).toBeLessThanOrEqual(1_024);
    expect(input.caption).toContain('Down 6 points since last week');
    expect(input.caption).toContain('Coverage fell 10 pts (70% → 60%)');
    expect([...Buffer.from(input.photoBase64, 'base64').subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(calls[0]?.secret).toBe(TOKEN);
  });

  it('keeps the history text the full report, with the headline first', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const { adapter } = scripted([ok]);
    await deliverTo(db, options, telegram, { telegram: adapter });
    const [row] = await db.select().from(schema.reportDeliveries);
    expect(row?.rendered).toContain('Down 6 points since last week');
    expect(row?.rendered?.split('\n')[1]).toContain('Down 6 points since last week');
  });

  it('sends the text when Telegram refuses the picture before sending anything', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const { adapter, calls } = scripted([refused('telegram_rejected_400'), ok]);
    const { outcomes, log } = await deliverTo(db, options, telegram, { telegram: adapter });
    expect(outcomes).toMatchObject([{ status: 'sent', errorCode: null }]);
    expect(calls.map((call) => call.request.operation)).toEqual(['sendPhoto', 'sendMessage']);
    expect((calls[1]?.request.input as { text: string }).text).toContain('Down 6 points');
    expect(log).toHaveBeenCalledWith(
      'report picture refused, sending the text',
      expect.objectContaining({ code: 'telegram_rejected_400' }),
    );
  });

  it('never sends a second message after an answer that may have been delivered', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    for (const code of ['telegram_transport_failed', 'telegram_200']) {
      const { adapter, calls } = scripted([refused(code), ok]);
      const { outcomes } = await deliverTo(db, options, telegram, { telegram: adapter });
      expect(calls, code).toHaveLength(1);
      expect(outcomes[0]?.status, code).toBe('failed');
    }
  });

  it('retries a transient failure later and does not fall back to the text meanwhile', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const { adapter, calls } = scripted([refused('telegram_rejected_429', true), ok]);
    const { outcomes } = await deliverTo(db, options, telegram, { telegram: adapter });
    expect(outcomes).toMatchObject([{ status: 'pending' }]);
    expect(calls).toHaveLength(1);
  });

  it('asks Slack to post the chart into a channel id, with the text as its comment', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const { adapter, calls } = scripted([ok]);
    await deliverTo(
      db,
      options,
      { kind: 'slack', name: 'QA', settings: { channel: 'C0123456789' }, secret: 'xoxb-test' },
      { slack: adapter },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.operation).toBe('postMessageWithImage');
    const input = calls[0]?.request.input as { channel: string; text: string; photoBase64: string };
    expect(input.channel).toBe('C0123456789');
    expect(input.text).toContain('Down 6 points since last week');
    expect([...Buffer.from(input.photoBase64, 'base64').subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it.each(['slack_channel_id_required', 'slack_api_error', 'slack_invalid_photo'])(
    'posts the text to Slack when the upload is refused as %s',
    async (code) => {
      const { db, options } = await setup();
      await seedCockpit(db);
      const { adapter, calls } = scripted([refused(code), ok]);
      const { outcomes } = await deliverTo(
        db,
        options,
        { kind: 'slack', name: 'QA', settings: { channel: '#qa' }, secret: 'xoxb-test' },
        { slack: adapter },
      );
      expect(outcomes).toMatchObject([{ status: 'sent' }]);
      expect(calls.map((call) => call.request.operation)).toEqual([
        'postMessageWithImage',
        'postMessage',
      ]);
      expect((calls[1]?.request.input as { channel: string }).channel).toBe('#qa');
    },
  );

  it('puts the chart in the Teams card', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const { adapter, calls } = scripted([ok]);
    await deliverTo(
      db,
      options,
      {
        kind: 'teams',
        name: 'QA',
        settings: {},
        secret: 'https://prod.logic.azure.com/hook?sig=s',
      },
      { teams: adapter },
    );
    const message = (
      calls[0]?.request.input as {
        message: { attachments: Array<{ content: { body: Array<Record<string, unknown>> } }> };
      }
    ).message;
    const image = message.attachments[0]?.content.body.find((block) => block['type'] === 'Image');
    expect(String(image?.['url']).startsWith('data:image/png;base64,')).toBe(true);
    expect(String(image?.['altText']).length).toBeGreaterThan(20);
  });

  it('sends WhatsApp and Signal the headline as text and no picture', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const { adapter, calls } = scripted([ok]);
    await deliverTo(
      db,
      options,
      {
        kind: 'signal',
        name: 'QA',
        settings: { number: '+15551234567', recipients: '+15557654321' },
        secret: 'http://192.168.1.10:8081',
      },
      { signal: adapter },
    );
    expect(calls[0]?.request.operation).toBe('send');
    expect(JSON.stringify(calls[0]?.request.input)).toContain('Down 6 points since last week');
    expect(JSON.stringify(calls[0]?.request.input)).not.toContain('photoBase64');
  });

  it('sends the report as it always was when the workspace has no project', async () => {
    const { db, options } = await setup();
    const { adapter, calls } = scripted([ok]);
    await deliverTo(db, options, telegram, { telegram: adapter });
    expect(calls[0]?.request.operation).toBe('sendMessage');
    expect((calls[0]?.request.input as { text: string }).text).not.toContain('Down');
  });

  it('says nothing was measured, without a picture, for a project that has no readings', async () => {
    const { db, options } = await setup();
    await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-1', name: 'Empty', slug: 'empty', defaultBranch: 'main' });
    const { adapter, calls } = scripted([ok]);
    await deliverTo(db, options, telegram, { telegram: adapter });
    expect(calls[0]?.request.operation).toBe('sendMessage');
    expect((calls[0]?.request.input as { text: string }).text).toContain(
      'Nothing was measured in the last 7 days.',
    );
  });

  it('does not put another workspace’s project in this workspace’s report', async () => {
    const { db, options } = await setup();
    await seedCockpit(db, 'ws-2');
    const { adapter, calls } = scripted([ok]);
    await deliverTo(db, options, telegram, { telegram: adapter });
    expect(calls[0]?.request.operation).toBe('sendMessage');
    expect(JSON.stringify(calls[0]?.request.input)).not.toContain('Down 6 points');
  });
});

describe('loadCockpitDigest', () => {
  it('is null for a workspace with no project, and says nothing about it', async () => {
    const { options } = await setup();
    const onError = vi.fn();
    expect(await loadCockpitDigest(options, onError)).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('is null, and says why, when the cockpit cannot be read', async () => {
    const { options } = await setup();
    const broken = {
      ...options,
      db: {
        select: () => {
          throw new Error('the database is unavailable');
        },
      } as never,
    };
    const onError = vi.fn();
    expect(await loadCockpitDigest(broken, onError)).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    // And with no one listening, it is still null and does not throw.
    expect(await loadCockpitDigest(broken)).toBeNull();
  });

  it('carries the cockpit’s sentence, its changes and a chart', async () => {
    const { db, options } = await setup();
    await seedCockpit(db);
    const digest = await loadCockpitDigest(options);
    expect(digest?.cockpit.headline).toBe(
      'Down 6 points since last week, mostly lower coverage and more flaky tests.',
    );
    expect(digest?.cockpit.tone).toBe('bad');
    expect(digest?.cockpit.changes.map((line) => line.text)).toEqual([
      'Coverage fell 10 pts (70% → 60%)',
      'Flaky tests rose by 3 (2 → 5)',
    ]);
    expect(digest?.image?.png.length).toBeGreaterThan(100);
  });
});
