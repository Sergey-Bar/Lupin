import { and, eq, sql } from 'drizzle-orm';
import { reportDeliveries, reportSubscriptions, type ReportDeliveryRow } from '@lupin/db';
import type { ConnectorAdapter, ConnectorRequest, ConnectorResult } from '@lupin/connectors-sdk';
import type { ChannelKind, ChannelSummary } from '@lupin/shared-contracts';
import {
  composeReport,
  applyLens,
  renderFullReport,
  renderPlain,
  renderSlack,
  renderTeams,
  renderTelegram,
  type ReportModel,
} from '@lupin/reporting';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';
import { loadCockpitDigest } from './cockpit-digest.js';
import {
  channelWithSecret,
  loadReport,
  projectOfScope,
  audienceOf,
  formatOf,
} from './notification-service.js';
import type { TrendChart } from './trend-chart.js';

/**
 * Sends the reports the worker queued.
 *
 * ## Exactly once, with two of these running
 *
 * A claim is one statement: move up to `batch` due rows to `sending` and push their
 * `next_attempt_at` a lease into the future, choosing them with `FOR UPDATE SKIP LOCKED`.
 * A second dispatcher in the same instant skips the locked rows, and after the commit
 * the rows are no longer due — so each delivery is in exactly one dispatcher's hands. A
 * dispatcher that dies mid-send leaves a `sending` row whose lease lapses, and the next
 * claim takes it again: a crash costs a retry, never a lost report.
 *
 * ## Retries
 *
 * A retryable failure (a rate limit, a refusal that sent nothing) goes back to `pending`
 * with a backoff, up to `maxAttempts`; anything else is `failed` with the adapter's stable
 * error code, which the history list shows. The adapters never retry an ambiguous failure
 * on a send, so a retry here cannot duplicate a message that arrived.
 */
export interface ReportDispatcherOptions {
  db: ProjectRegistryServiceOptions['db'];
  vaultSecret: string | undefined;
  adapters: Partial<Record<Exclude<ChannelKind, 'inbox'>, ConnectorAdapter>>;
  /** The dashboard link a report carries. */
  link: string | null;
  now?: () => Date;
  batch?: number;
  maxAttempts?: number;
  leaseMs?: number;
  log?: (message: string, details: Record<string, unknown>) => void;
}

export interface DispatchOutcome {
  id: string;
  status: 'sent' | 'failed' | 'pending';
  errorCode: string | null;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

/**
 * The error codes that mean the platform refused a request and sent nothing: Telegram's and
 * Slack's refusals, and the adapters' own refusals of the input before any request. A code
 * for a status line (`slack_502`) or a transport failure is absent on purpose, because those
 * may follow a message that arrived.
 */
const NOTHING_WAS_SENT =
  /^(slack_(api_error|channel_id_required|invalid_[a-z_]+)|telegram_(rejected_\d+|invalid_[a-z_]+|caption_too_long))$/u;

/**
 * The request for one channel, the text kept as history, and, when the primary request carries
 * a picture, the plain request to send if the picture is refused.
 *
 * `fullHtml` is the full-report HTML, supplied only for an email channel whose subscription
 * chose `format: 'full'`; every other channel ignores it and sends the compact digest, which is
 * the shape their length limits require.
 */
export function requestFor(
  channel: ChannelSummary,
  model: ReportModel,
  image: TrendChart | null = null,
  fullHtml: string | null = null,
): { request: ConnectorRequest | null; fallback?: ConnectorRequest; rendered: string } {
  const settings = channel.settings as Record<string, string>;
  const plain = renderPlain(model, 2_000);
  const photoBase64 = image === null ? null : Buffer.from(image.png).toString('base64');
  switch (channel.kind) {
    case 'inbox':
      return { request: null, rendered: plain };
    case 'slack': {
      const text = renderSlack(model);
      const post: ConnectorRequest = {
        operation: 'postMessage',
        input: { channel: settings['channel'], text },
      };
      // The upload needs a channel id, and the adapter says so before any request when it was
      // given a name; the plain post is then sent, exactly as before the picture existed.
      return photoBase64 === null
        ? { request: post, rendered: text }
        : {
            request: {
              operation: 'postMessageWithImage',
              input: {
                channel: settings['channel'],
                text,
                photoBase64,
                title: 'Pace against quality',
              },
            },
            fallback: post,
            rendered: text,
          };
    }
    case 'teams':
      return {
        request: {
          operation: 'postCard',
          input: {
            message: renderTeams(
              model,
              photoBase64 === null || image === null
                ? undefined
                : { dataUri: `data:image/png;base64,${photoBase64}`, alt: image.alt },
            ),
          },
        },
        rendered: plain,
      };
    case 'telegram': {
      const text = renderTelegram(model);
      const send: ConnectorRequest = {
        operation: 'sendMessage',
        input: { chatId: settings['chatId'], text },
      };
      return photoBase64 === null
        ? { request: send, rendered: text }
        : {
            request: {
              operation: 'sendPhoto',
              // A caption is at most 1,024 characters; the digest renders for that limit.
              input: {
                chatId: settings['chatId'],
                caption: renderTelegram(model, 1_024),
                photoBase64,
              },
            },
            fallback: send,
            rendered: text,
          };
    }
    case 'whatsapp': {
      // A template's body parameter may not hold a newline, so lines are joined.
      const text = renderPlain(model).replace(/\n/gu, ' · ');
      return {
        request: { operation: 'sendTemplate', input: { ...settings, text } },
        rendered: text,
      };
    }
    case 'signal':
      return {
        request: { operation: 'send', input: { ...settings, message: plain } },
        rendered: plain,
      };
    case 'email': {
      // `from`/`to`/`subject` come from the channel's settings; the body is the digest as text,
      // with the full report's HTML as the alternative when the subscription chose `full`.
      const subject = settings['subject'] ?? 'Lupin quality report';
      return {
        request: {
          operation: 'send',
          input: {
            from: settings['from'],
            to: settings['to'],
            subject,
            text: plain,
            ...(fullHtml === null ? {} : { html: fullHtml }),
          },
        },
        // The history keeps the text form: it is what the in-app inbox and the delivery list
        // show, and the HTML is not a thing a person reads in a table.
        rendered: plain,
      };
    }
  }
}

export function createReportDispatcher(options: ReportDispatcherOptions) {
  const clock = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 3;
  const leaseMs = options.leaseMs ?? 5 * 60_000;

  async function claim(): Promise<ReportDeliveryRow[]> {
    const at = clock();
    const result = await options.db.execute(sql`
      UPDATE report_deliveries
      SET status = 'sending', attempts = attempts + 1,
          next_attempt_at = ${new Date(at.getTime() + leaseMs).toISOString()}::timestamptz
      WHERE id IN (
        SELECT id FROM report_deliveries
        WHERE status IN ('pending', 'sending')
          AND next_attempt_at <= ${at.toISOString()}::timestamptz
        ORDER BY next_attempt_at
        LIMIT ${options.batch ?? 10}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`);
    const ids = ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []).map(
      (row) => row.id,
    );
    if (ids.length === 0) return [];
    return options.db
      .select()
      .from(reportDeliveries)
      .where(
        sql`${reportDeliveries.id} IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
  }

  async function finish(
    row: ReportDeliveryRow,
    outcome: DispatchOutcome & { rendered: string | null },
  ) {
    const at = clock();
    const retry = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)] ?? 60_000;
    await options.db
      .update(reportDeliveries)
      .set({
        status: outcome.status,
        errorCode: outcome.errorCode,
        ...(outcome.rendered === null ? {} : { rendered: outcome.rendered }),
        ...(outcome.status === 'sent' ? { sentAt: at } : {}),
        ...(outcome.status === 'pending' ? { nextAttemptAt: new Date(at.getTime() + retry) } : {}),
      })
      .where(eq(reportDeliveries.id, row.id));
  }

  async function subscriptionOf(row: ReportDeliveryRow) {
    if (row.subscriptionId === null) return null;
    const [subscription] = await options.db
      .select()
      .from(reportSubscriptions)
      .where(
        and(
          eq(reportSubscriptions.workspaceId, row.workspaceId),
          eq(reportSubscriptions.id, row.subscriptionId),
        ),
      )
      .limit(1);
    return subscription ?? null;
  }

  type Scoped = Parameters<typeof loadReport>[0];

  /**
   * The report for one delivery: what it always said, with the cockpit at its head when the
   * workspace has one, and the chart beside it. A report without a cockpit is the report it
   * always was.
   */
  async function composeFor(
    scoped: Scoped,
    subscription: Awaited<ReturnType<typeof subscriptionOf>>,
  ): Promise<{ model: ReportModel; image: TrendChart | null; fullHtml: string | null }> {
    const digest = await loadCockpitDigest(
      scoped,
      (error) =>
        options.log?.('cockpit digest unavailable', {
          error: error instanceof Error ? error.message : String(error),
        }),
      projectOfScope(subscription?.projectScope),
    );
    const model = composeReport(
      applyLens(
        {
          ...(await loadReport(scoped, {
            title: subscription?.name ?? 'Test report from Lupin',
            windowDays: subscription?.cadence === 'daily' ? 1 : 7,
            link: options.link,
          })),
          ...(digest === null ? {} : { cockpit: digest.cockpit }),
        },
        // The audience tunes which areas lead; a subscription from before the column existed,
        // or a test send with no subscription, is `general` — the report exactly as it was.
        audienceOf(subscription?.audience),
      ),
    );
    // The full-report HTML is rendered only when the subscription asked for `full`; every other
    // delivery carries the digest alone. `clock` is the one time in the page, so a redelivery of
    // the same window is the same bytes.
    const fullHtml =
      formatOf(subscription?.format) === 'full'
        ? renderFullReport(model, { generatedAt: clock().toISOString() })
        : null;
    return { model, image: digest?.image ?? null, fullHtml };
  }

  /**
   * Sends the request, and the plain one in its place when the picture was refused before
   * anything was sent. Only a refusal qualifies: an answer that may already have been delivered
   * is never followed by a second message, because that is a duplicate.
   */
  async function sendWithFallback(
    row: ReportDeliveryRow,
    adapter: ConnectorAdapter,
    secret: string,
    request: ConnectorRequest,
    fallback: ConnectorRequest | undefined,
  ): Promise<ConnectorResult> {
    const result = await adapter.execute(request, secret);
    if (
      result.status !== 'error' ||
      fallback === undefined ||
      result.error?.retryable === true ||
      !NOTHING_WAS_SENT.test(result.error?.code ?? '')
    ) {
      return result;
    }
    options.log?.('report picture refused, sending the text', {
      id: row.id,
      code: result.error?.code,
    });
    return adapter.execute(fallback, secret);
  }

  function statusOf(row: ReportDeliveryRow, result: ConnectorResult): DispatchOutcome['status'] {
    if (result.status === 'ok') return 'sent';
    return result.error?.retryable === true && row.attempts < maxAttempts ? 'pending' : 'failed';
  }
  async function deliver(row: ReportDeliveryRow): Promise<DispatchOutcome> {
    const scoped = {
      db: options.db,
      workspaceId: row.workspaceId,
      vaultSecret: options.vaultSecret,
      now: clock,
    };
    const subscription = await subscriptionOf(row);
    const channelId = row.channelId ?? subscription?.channelId ?? null;
    if (channelId === null) {
      const outcome = { id: row.id, status: 'failed' as const, errorCode: 'channel_missing' };
      await finish(row, { ...outcome, rendered: null });
      return outcome;
    }
    try {
      const { channel, secret } = await channelWithSecret(scoped, channelId);
      const { model, image, fullHtml } = await composeFor(scoped, subscription);
      const { request, fallback, rendered } = requestFor(channel, model, image, fullHtml);
      if (request === null) {
        const outcome = { id: row.id, status: 'sent' as const, errorCode: null };
        await finish(row, { ...outcome, rendered });
        return outcome;
      }
      const adapter = options.adapters[channel.kind as Exclude<ChannelKind, 'inbox'>];
      if (adapter === undefined || secret === null) {
        const outcome = {
          id: row.id,
          status: 'failed' as const,
          errorCode: `${channel.kind}_not_configured`,
        };
        await finish(row, { ...outcome, rendered });
        return outcome;
      }
      const result = await sendWithFallback(row, adapter, secret, request, fallback);
      const status = statusOf(row, result);
      const outcome = { id: row.id, status, errorCode: result.error?.code ?? null };
      await finish(row, { ...outcome, rendered });
      return outcome;
    } catch (error) {
      // A channel deleted since it was queued, or a vault that will not open: final, and
      // named, so the history says why rather than showing a row stuck in `sending`.
      const errorCode =
        typeof (error as { code?: unknown }).code === 'string'
          ? `delivery_${String((error as { code: string }).code).toLowerCase()}`
          : 'delivery_failed';
      const outcome = { id: row.id, status: 'failed' as const, errorCode };
      await finish(row, { ...outcome, rendered: null });
      return outcome;
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> = Promise.resolve();

  return {
    /** One claim, and every claimed delivery sent. */
    async runOnce(): Promise<DispatchOutcome[]> {
      const claimed = await claim();
      const outcomes: DispatchOutcome[] = [];
      for (const row of claimed) outcomes.push(await deliver(row));
      for (const outcome of outcomes) options.log?.('report delivery', { ...outcome });
      return outcomes;
    },
    start(intervalMs: number): void {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        running = running
          .then(() => this.runOnce())
          .catch((error: unknown) =>
            options.log?.('report dispatch failed', {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      }, intervalMs);
      timer.unref();
    },
    async stop(): Promise<void> {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await running;
    },
  };
}

export type ReportDispatcher = ReturnType<typeof createReportDispatcher>;
