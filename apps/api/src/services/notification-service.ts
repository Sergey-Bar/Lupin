import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { Cron } from 'croner';
import {
  notificationChannels,
  projects,
  reportDeliveries,
  reportSubscriptions,
  runs,
  schedules,
  tests,
  type NotificationChannelRow,
  type ReportDeliveryRow,
  type ReportSubscriptionRow,
} from '@lupin/db';
import { CreateChannelBodySchema, type UpdateChannelBody } from '@lupin/shared-contracts';
import type {
  ChannelKind,
  ChannelSummary,
  CreateChannelBody,
  CreateSubscriptionBody,
  DeliverySummary,
  SubscriptionSummary,
} from '@lupin/shared-contracts';
import {
  applyLens,
  buildDigest,
  composeReport,
  type ReportInput,
  type ReportModel,
} from '@lupin/reporting';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { isAllowedWebhook } from './health-integrations.js';
import { loadReportAreas } from './report-areas.js';
import { loadCockpitDigest } from './cockpit-digest.js';
import {
  deleteVaultSecret,
  readVaultSecret,
  storeVaultSecret,
  type VaultOptions,
} from './vault-secrets.js';

/**
 * Scheduled reports: channels, subscriptions, deliveries, and the data a report is made of.
 *
 * ## Who does what
 *
 * Saving a subscription writes a `schedules` row, id `report:<subscriptionId>`, with
 * `run_options.kind = 'report'`. The worker — which has the clock and not the vault — turns
 * each due occurrence into a pending `report_deliveries` row, once (the idempotency key is
 * unique). The API's dispatcher (`report-dispatcher.ts`) claims pending rows, opens the
 * channel's credential, renders, and sends. Nothing here sends.
 *
 * ## Secrets
 *
 * A channel's credential is sealed under `channel:<id>` (`vault-secrets.ts`) and is never
 * returned: `ChannelSummary` has no field for it.
 */
export type NotificationOptions = VaultOptions & { now?: () => Date };

const channelSecretName = (id: string): string => `channel:${id}`;
const scheduleIdFor = (subscriptionId: string): string => `report:${subscriptionId}`;
const UUID = /^[0-9a-f-]{36}$/iu;
const WHAT = 'A notification channel';

function now(options: NotificationOptions): Date {
  return options.now?.() ?? new Date();
}

function channelSummary(row: NotificationChannelRow): ChannelSummary {
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    name: row.name,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A secret the server will call: refused here rather than on the first delivery. */
function assertCallableSecret(body: CreateChannelBody): void {
  if (body.kind === 'teams' && !isAllowedWebhook(body.secret)) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      'A Teams webhook must be an https URL on a public host',
    );
  }
  if (body.kind === 'signal') {
    // The bridge is expected on this machine or the LAN, so a private http address is
    // allowed for this kind alone — but it must be a URL with no credentials in it.
    const url = URL.canParse(body.secret) ? new URL(body.secret) : null;
    if (url === null || !['http:', 'https:'].includes(url.protocol) || url.username !== '') {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        'The Signal bridge must be an http(s) URL',
      );
    }
  }
}

export async function createChannel(
  options: NotificationOptions,
  body: CreateChannelBody,
): Promise<ChannelSummary> {
  if (body.kind !== 'inbox') assertCallableSecret(body);
  const at = now(options);
  const [row] = await options.db
    .insert(notificationChannels)
    .values({
      workspaceId: options.workspaceId,
      kind: body.kind,
      name: body.name,
      settings: body.settings,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  const created = row as NotificationChannelRow;
  if (body.kind !== 'inbox') {
    try {
      await storeVaultSecret(options, channelSecretName(created.id), body.secret, WHAT);
    } catch (error) {
      // No half-made channel: one with no credential could only ever fail.
      await options.db.delete(notificationChannels).where(eq(notificationChannels.id, created.id));
      throw error;
    }
  }
  return channelSummary(created);
}

export async function listChannels(options: NotificationOptions): Promise<ChannelSummary[]> {
  const rows = await options.db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.workspaceId, options.workspaceId))
    .orderBy(notificationChannels.createdAt);
  return rows.map(channelSummary);
}

async function channelRow(
  options: NotificationOptions,
  id: string,
): Promise<NotificationChannelRow> {
  const [row] = UUID.test(id)
    ? await options.db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.workspaceId, options.workspaceId),
            eq(notificationChannels.id, id),
          ),
        )
        .limit(1)
    : [];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No channel ${id}`);
  return row;
}

/** The channel and its opened credential (`null` for the inbox), for the dispatcher only. */
export async function channelWithSecret(
  options: NotificationOptions,
  id: string,
): Promise<{ channel: ChannelSummary; secret: string | null }> {
  const row = await channelRow(options, id);
  const secret =
    row.kind === 'inbox' ? null : await readVaultSecret(options, channelSecretName(row.id), WHAT);
  return { channel: channelSummary(row), secret };
}

export async function deleteChannel(options: NotificationOptions, id: string): Promise<void> {
  const row = await channelRow(options, id);
  const subscriptions = await options.db
    .select({ id: reportSubscriptions.id })
    .from(reportSubscriptions)
    .where(
      and(
        eq(reportSubscriptions.workspaceId, options.workspaceId),
        eq(reportSubscriptions.channelId, row.id),
      ),
    );
  for (const subscription of subscriptions) await deleteSchedule(options, subscription.id);
  await deleteVaultSecret(options, channelSecretName(row.id));
  // Subscriptions go with the channel (cascade); deliveries stay, as history.
  await options.db.delete(notificationChannels).where(eq(notificationChannels.id, row.id));
}

/**
 * Edits a channel in place. Settings are checked against the kind's own schema, and a new
 * secret against the same rules a new channel's is; an absent secret keeps the stored one.
 */
export async function updateChannel(
  options: NotificationOptions,
  id: string,
  body: UpdateChannelBody,
): Promise<ChannelSummary> {
  const row = await channelRow(options, id);
  const candidate = {
    kind: row.kind,
    name: body.name ?? row.name,
    settings: body.settings ?? row.settings ?? {},
    // A placeholder stands in for a kept secret: only its presence is checked here.
    ...(row.kind === 'inbox' ? {} : { secret: body.secret ?? 'kept' }),
  };
  const parsed = CreateChannelBodySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid channel settings', {
      details: { issues: parsed.error.issues },
    });
  }
  if (body.secret !== undefined && parsed.data.kind !== 'inbox') assertCallableSecret(parsed.data);
  if (body.secret !== undefined && row.kind !== 'inbox') {
    await storeVaultSecret(options, channelSecretName(row.id), body.secret, WHAT);
  }
  const [updated] = await options.db
    .update(notificationChannels)
    .set({
      name: parsed.data.name,
      settings: parsed.data.settings,
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      updatedAt: now(options),
    })
    .where(
      and(
        eq(notificationChannels.workspaceId, options.workspaceId),
        eq(notificationChannels.id, row.id),
      ),
    )
    .returning();
  return channelSummary(updated as NotificationChannelRow);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The cron a cadence means, in the subscription's own timezone. */
export function cronFor(body: CreateSubscriptionBody): string {
  if (body.cadence === 'custom') return (body.cronExpr ?? '').trim();
  const [hour = '9', minute = '0'] = body.time.split(':').map((part) => String(Number(part)));
  return body.cadence === 'daily'
    ? `${minute} ${hour} * * *`
    : `${minute} ${hour} * * ${String(body.weekday)}`;
}

/** "Every Monday at 09:00", so the page never asks anyone to read cron. */
export function describeCadence(cadence: string, cronExpr: string): string {
  const parts = cronExpr.trim().split(/\s+/u);
  const [minute, hour, dayOfMonth, month, weekday] = parts;
  const simple = (value: string | undefined) => value !== undefined && /^\d+$/u.test(value);
  if (parts.length === 5 && simple(minute) && simple(hour) && dayOfMonth === '*' && month === '*') {
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (weekday === '*') return `Every day at ${time}`;
    if (weekday === '1-5') return `Weekdays at ${time}`;
    if (simple(weekday)) return `Every ${WEEKDAYS[Number(weekday) % 7] ?? 'week'} at ${time}`;
  }
  return cadence === 'custom' ? `Custom: ${cronExpr}` : cronExpr;
}

/**
 * The first occurrence after `after`, or a refusal naming what is wrong.
 *
 * Validated here, on save, because the worker validates at poll time: a bad expression
 * saved today would otherwise fail every poll from now on with nothing on the page to say so.
 */
export function nextOccurrence(cronExpr: string, timezone: string, after: Date): Date {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new DomainError(ErrorCode.INVALID_SCHEDULE, `Unknown timezone ${timezone}`);
  }
  let cron: Cron;
  try {
    cron = new Cron(cronExpr, { timezone, paused: true });
  } catch {
    throw new DomainError(ErrorCode.INVALID_SCHEDULE, `Not a cron expression: ${cronExpr}`);
  }
  const next = cron.nextRun(after);
  if (next === null) throw new DomainError(ErrorCode.INVALID_SCHEDULE, 'The schedule never fires');
  return next;
}

function subscriptionSummary(
  row: ReportSubscriptionRow,
  nextRunAt: string | null,
): SubscriptionSummary {
  return {
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    cadence: row.cadence as SubscriptionSummary['cadence'],
    cronExpr: row.cronExpr,
    timezone: row.timezone,
    enabled: row.enabled,
    describe: describeCadence(row.cadence, row.cronExpr),
    nextRunAt,
    projectId: projectOfScope(row.projectScope),
    // Null is the pre-existing shape, read as the safe default so an old subscription keeps
    // the report it always sent.
    audience: audienceOf(row.audience),
    format: formatOf(row.format),
    quietHours:
      row.quietStart === null || row.quietEnd === null
        ? null
        : { start: row.quietStart, end: row.quietEnd },
  };
}

/** A stored audience, or the default `general` for a row from before the column existed. */
export function audienceOf(value: unknown): SubscriptionSummary['audience'] {
  return value === 'manager' || value === 'sdet' || value === 'quality' ? value : 'general';
}

/** A stored format, or the default `chat` for a row from before the column existed. */
export function formatOf(value: unknown): SubscriptionSummary['format'] {
  return value === 'full' ? 'full' : 'chat';
}

/** The project a subscription's cockpit section is about: the first id in its scope, if any. */
export function projectOfScope(scope: unknown): string | null {
  const first = Array.isArray(scope) ? (scope as unknown[])[0] : undefined;
  return typeof first === 'string' ? first : null;
}

/** A project of this workspace, or a refusal: a report must not be pointed at someone else's. */
async function assertProject(options: NotificationOptions, projectId: string): Promise<void> {
  const [row] = await options.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No project ${projectId}`);
}

export async function createSubscription(
  options: NotificationOptions,
  body: CreateSubscriptionBody,
): Promise<SubscriptionSummary> {
  const channel = await channelRow(options, body.channelId);
  if (body.projectId !== undefined) await assertProject(options, body.projectId);
  const cronExpr = cronFor(body);
  const at = now(options);
  const next = nextOccurrence(cronExpr, body.timezone, at);
  const [row] = await options.db
    .insert(reportSubscriptions)
    .values({
      workspaceId: options.workspaceId,
      channelId: channel.id,
      name: body.name,
      cadence: body.cadence,
      cronExpr,
      timezone: body.timezone,
      projectScope: body.projectId === undefined ? null : [body.projectId],
      // Omitted stays null, which reads as the default (`general`/`chat`): the column
      // distinguishes "unset" from a deliberate choice.
      audience: body.audience ?? null,
      format: body.format ?? null,
      quietStart: body.quietHours?.start ?? null,
      quietEnd: body.quietHours?.end ?? null,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  const created = row as ReportSubscriptionRow;
  // `run_once`: one catch-up after downtime, never a backlog of identical reports.
  await options.db
    .insert(schedules)
    .values({
      id: scheduleIdFor(created.id),
      cronExpr,
      runOptions: {
        kind: 'report',
        subscriptionId: created.id,
        timezone: body.timezone,
        misfirePolicy: 'run_once',
        nextRunAt: next.toISOString(),
        // The worker's copy, read where it reads the timezone.
        ...(body.quietHours === undefined ? {} : { quietHours: body.quietHours }),
      },
      enabled: true,
      workspaceId: options.workspaceId,
      createdAt: at,
    })
    .onConflictDoNothing();
  return subscriptionSummary(created, next.toISOString());
}

export async function listSubscriptions(
  options: NotificationOptions,
): Promise<SubscriptionSummary[]> {
  const rows = await options.db
    .select({ subscription: reportSubscriptions, runOptions: schedules.runOptions })
    .from(reportSubscriptions)
    .leftJoin(
      schedules,
      and(
        eq(schedules.workspaceId, reportSubscriptions.workspaceId),
        eq(schedules.id, sql`'report:' || ${reportSubscriptions.id}::text`),
      ),
    )
    .where(eq(reportSubscriptions.workspaceId, options.workspaceId))
    .orderBy(reportSubscriptions.createdAt);
  return rows.map(({ subscription, runOptions }) => {
    const next = (runOptions as Record<string, unknown> | null)?.['nextRunAt'];
    return subscriptionSummary(subscription, typeof next === 'string' ? next : null);
  });
}

async function deleteSchedule(options: NotificationOptions, subscriptionId: string): Promise<void> {
  await options.db
    .delete(schedules)
    .where(
      and(
        eq(schedules.workspaceId, options.workspaceId),
        eq(schedules.id, scheduleIdFor(subscriptionId)),
      ),
    );
}

/**
 * Replaces a subscription's settings and moves its schedule to match (plan Wave 1 task 4).
 * The body is the create body, so an edit is validated exactly as a new one is.
 */
export async function updateSubscription(
  options: NotificationOptions,
  id: string,
  body: CreateSubscriptionBody,
): Promise<SubscriptionSummary> {
  const channel = await channelRow(options, body.channelId);
  if (body.projectId !== undefined) await assertProject(options, body.projectId);
  const cronExpr = cronFor(body);
  const at = now(options);
  const next = nextOccurrence(cronExpr, body.timezone, at);
  const [row] = UUID.test(id)
    ? await options.db
        .update(reportSubscriptions)
        .set({
          channelId: channel.id,
          name: body.name,
          cadence: body.cadence,
          cronExpr,
          timezone: body.timezone,
          projectScope: body.projectId === undefined ? null : [body.projectId],
          audience: body.audience ?? null,
          format: body.format ?? null,
          quietStart: body.quietHours?.start ?? null,
          quietEnd: body.quietHours?.end ?? null,
          updatedAt: at,
        })
        .where(
          and(
            eq(reportSubscriptions.workspaceId, options.workspaceId),
            eq(reportSubscriptions.id, id),
          ),
        )
        .returning()
    : [];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No subscription ${id}`);
  await options.db
    .update(schedules)
    .set({
      cronExpr,
      runOptions: {
        kind: 'report',
        subscriptionId: row.id,
        timezone: body.timezone,
        misfirePolicy: 'run_once',
        nextRunAt: next.toISOString(),
        ...(body.quietHours === undefined ? {} : { quietHours: body.quietHours }),
      },
    })
    .where(
      and(eq(schedules.workspaceId, options.workspaceId), eq(schedules.id, scheduleIdFor(row.id))),
    );
  return subscriptionSummary(row, next.toISOString());
}

export async function deleteSubscription(options: NotificationOptions, id: string): Promise<void> {
  const [row] = UUID.test(id)
    ? await options.db
        .delete(reportSubscriptions)
        .where(
          and(
            eq(reportSubscriptions.workspaceId, options.workspaceId),
            eq(reportSubscriptions.id, id),
          ),
        )
        .returning({ id: reportSubscriptions.id })
    : [];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No subscription ${id}`);
  await deleteSchedule(options, row.id);
}

export function deliverySummary(row: ReportDeliveryRow): DeliverySummary {
  return {
    id: row.id,
    channelId: row.channelId,
    subscriptionId: row.subscriptionId,
    status: row.status as DeliverySummary['status'],
    attempts: row.attempts,
    errorCode: row.errorCode,
    scheduledFor: row.scheduledFor.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    rendered: row.rendered,
  };
}

export async function listDeliveries(
  options: NotificationOptions,
  limit = 50,
): Promise<DeliverySummary[]> {
  const rows = await options.db
    .select()
    .from(reportDeliveries)
    .where(eq(reportDeliveries.workspaceId, options.workspaceId))
    .orderBy(desc(reportDeliveries.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(deliverySummary);
}

/** A test send: one delivery, due now, to one channel. The dispatcher sends it. */
export async function queueTestDelivery(
  options: NotificationOptions,
  channelId: string,
): Promise<string> {
  const channel = await channelRow(options, channelId);
  const at = now(options);
  const [row] = await options.db
    .insert(reportDeliveries)
    .values({
      workspaceId: options.workspaceId,
      channelId: channel.id,
      idempotencyKey: `test:${randomUUID()}`,
      scheduledFor: at,
      nextAttemptAt: at,
      createdAt: at,
    })
    .returning({ id: reportDeliveries.id });
  return (row as { id: string }).id;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface Window {
  runs: number;
  passRate: number | null;
  failed: Array<{ label: string }>;
}

async function windowOf(options: NotificationOptions, from: Date, to: Date): Promise<Window> {
  const rows = await options.db
    .select({ id: runs.id, status: runs.status, suite: runs.suite })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, options.workspaceId),
        gte(runs.startedAt, from),
        lt(runs.startedAt, to),
      ),
    )
    .orderBy(desc(runs.startedAt));
  const finished = rows.filter((row) => row.status === 'passed' || row.status === 'failed');
  const passed = finished.filter((row) => row.status === 'passed').length;
  return {
    runs: rows.length,
    passRate: finished.length === 0 ? null : (passed / finished.length) * 100,
    failed: rows
      .filter((row) => row.status === 'failed')
      .map((row) => ({ label: row.suite ?? `run ${row.id.slice(0, 8)}` })),
  };
}

/** A test is "slower" when its median grew this much, over at least this many runs each side. */
export const SLOW_CHANGE_PCT = 25;
export const SLOW_MIN_RUNS = 3;
/** And by at least this many milliseconds: 4ms to 6ms is 50%, and nobody's news. */
export const SLOW_MIN_MS = 50;
/** Test rows read per window: the digest describes the newest when a window holds more. */
export const DIGEST_TEST_ROWS = 20_000;

interface TestWindow {
  flakyKeys: string[];
  failingKeys: string[];
  /** stableId → its passing durations, and its title. */
  durations: Map<string, { title: string; ms: number[] }>;
}

/** The window's tests, by stable identity: which flaked, which failed, how long each passed in. */
async function testsOf(options: NotificationOptions, from: Date, to: Date): Promise<TestWindow> {
  const rows = await options.db
    .select({
      stableId: tests.stableId,
      title: tests.title,
      status: tests.status,
      durationMs: tests.durationMs,
    })
    .from(tests)
    .innerJoin(runs, eq(runs.id, tests.runId))
    .where(
      and(
        eq(tests.workspaceId, options.workspaceId),
        eq(runs.workspaceId, options.workspaceId),
        gte(runs.startedAt, from),
        lt(runs.startedAt, to),
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(DIGEST_TEST_ROWS);
  const flaky = new Set<string>();
  const failing = new Set<string>();
  const durations = new Map<string, { title: string; ms: number[] }>();
  for (const row of rows) {
    if (row.status === 'flaky') flaky.add(row.stableId);
    if (row.status === 'failed' || row.status === 'timed_out') failing.add(row.stableId);
    if (row.status === 'passed' && row.durationMs !== null) {
      const entry = durations.get(row.stableId) ?? { title: row.title, ms: [] };
      entry.ms.push(row.durationMs);
      durations.set(row.stableId, entry);
    }
  }
  return { flakyKeys: [...flaky], failingKeys: [...failing], durations };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Tests whose passing median grew past the noise, worst first. */
export function slowerTests(
  current: TestWindow['durations'],
  previous: TestWindow['durations'],
): Array<{ key: string; title: string; changePct: number }> {
  const slower: Array<{ key: string; title: string; changePct: number }> = [];
  for (const [key, now] of current) {
    const before = previous.get(key);
    if (before === undefined || now.ms.length < SLOW_MIN_RUNS || before.ms.length < SLOW_MIN_RUNS) {
      continue;
    }
    const was = median(before.ms);
    const is = median(now.ms);
    if (was <= 0 || is - was < SLOW_MIN_MS) continue;
    const changePct = ((is - was) / was) * 100;
    if (changePct >= SLOW_CHANGE_PCT) slower.push({ key, title: now.title, changePct });
  }
  return slower.sort((a, b) => b.changePct - a.changePct);
}

/**
 * What a report says, for one workspace over its window: the runs, the pass rate and its
 * change, the tests that turned flaky, started failing, got fixed or slowed, and the failed
 * runs as the things that need someone.
 *
 * Coverage is left to the cockpit's headline, which reads it per project from the health
 * snapshots and leads the report; saying it twice, once averaged across projects, would be
 * two numbers for one thing.
 */
export async function loadReport(
  options: NotificationOptions,
  input: { title: string; windowDays: number; link: string | null },
): Promise<ReportInput> {
  const end = now(options);
  const start = new Date(end.getTime() - input.windowDays * DAY_MS);
  const before = new Date(start.getTime() - input.windowDays * DAY_MS);
  const [current, previous, currentTests, previousTests] = await Promise.all([
    windowOf(options, start, end),
    windowOf(options, before, start),
    testsOf(options, start, end),
    testsOf(options, before, start),
  ]);
  const digest = buildDigest({
    current: {
      ...current,
      flakyKeys: currentTests.flakyKeys,
      failingKeys: currentTests.failingKeys,
      slowKeys: slowerTests(currentTests.durations, previousTests.durations),
    },
    previous: {
      ...previous,
      flakyKeys: previousTests.flakyKeys,
      failingKeys: previousTests.failingKeys,
    },
    coverageDelta: null,
  });
  const failedBySuite = new Map<string, number>();
  for (const run of current.failed) {
    failedBySuite.set(run.label, (failedBySuite.get(run.label) ?? 0) + 1);
  }
  return {
    title: input.title,
    runs: current.runs,
    passRate: current.passRate,
    attention: [...failedBySuite].map(([label, count]) => ({
      severity: 'bad' as const,
      text: count === 1 ? `${label} failed` : `${label} failed ${String(count)} times`,
    })),
    digest,
    link: input.link,
    // DORA, AI code and agent quality across the projects, and the top actions' inputs.
    ...(await loadReportAreas(options)),
  };
}

/**
 * The composed report model for a workspace, lensed for an audience — the one place both the
 * dispatcher's chat digest and the full-report download get their model, so the two never
 * disagree. The cockpit leads when the workspace has a project to read; a workspace with none
 * gets the report it always was. Pure composition over the reads: no transport, no I/O beyond
 * the same `loadReport`/`loadReportAreas`/`loadCockpitDigest` the dispatcher uses.
 */
export async function composeWorkspaceReportModel(
  options: NotificationOptions,
  input: {
    title: string;
    windowDays: number;
    link: string | null;
    audience?: SubscriptionSummary['audience'];
    projectId?: string | null;
  },
): Promise<ReportModel> {
  const digest = await loadCockpitDigest(options, undefined, input.projectId ?? null).catch(
    () => null,
  );
  return composeReport(
    applyLens(
      {
        ...(await loadReport(options, {
          title: input.title,
          windowDays: input.windowDays,
          link: input.link,
        })),
        ...(digest === null ? {} : { cockpit: digest.cockpit }),
      },
      audienceOf(input.audience),
    ),
  );
}
