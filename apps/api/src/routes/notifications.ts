import { Hono, type Context } from 'hono';
import {
  CreateChannelBodySchema,
  CreateSubscriptionBodySchema,
  UpdateChannelBodySchema,
  type ReportPreview,
} from '@lupin/shared-contracts';
import { renderFullReport, renderPlain } from '@lupin/reporting';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import {
  createChannel,
  createSubscription,
  deleteChannel,
  deleteSubscription,
  listChannels,
  listDeliveries,
  listSubscriptions,
  composeWorkspaceReportModel,
  queueTestDelivery,
  updateChannel,
  type NotificationOptions,
} from '../services/notification-service.js';

export interface NotificationRouteOptions extends NotificationOptions {
  access: CallerResolver;
  /** The dashboard link a report carries. */
  link: string | null;
  /** Sends what is due now, so a test send arrives while the person is still looking. */
  dispatchNow?: () => Promise<unknown>;
}

async function body(context: Context): Promise<unknown> {
  return context.req.json().catch(() => null);
}

function invalid(issues: unknown): DomainError {
  return new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid request', {
    details: { issues },
  });
}

/**
 * Scheduled reports. Who may do what:
 *
 *  - viewer: see channels, subscriptions, the delivery history (the in-app inbox), a preview;
 *  - operator: add and remove subscriptions — when and how often a report goes out;
 *  - admin: add and remove channels and send a test — a channel holds a credential.
 */
export function createNotificationRoutes(options: NotificationRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);
  const operator = requireRole('operator', options.access);
  const admin = requireRole('admin', options.access);
  const actor = async (context: Context) => (await callerOf(context, options.access)).actor;

  app.get('/api/v1/notification-channels', viewer, async (context) =>
    context.json({ channels: await listChannels(options) }),
  );

  app.post('/api/v1/notification-channels', admin, async (context) => {
    const parsed = CreateChannelBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues);
    const channel = await createChannel(options, parsed.data);
    await audit(options, {
      actor: await actor(context),
      action: 'notification-channel.create',
      resourceType: 'notification_channel',
      resourceId: channel.id,
      details: { kind: channel.kind },
    });
    return context.json(channel, 201);
  });

  app.patch('/api/v1/notification-channels/:id', admin, async (context) => {
    const parsed = UpdateChannelBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues);
    const channel = await updateChannel(options, context.req.param('id'), parsed.data);
    await audit(options, {
      actor: await actor(context),
      action: 'notification-channel.update',
      resourceType: 'notification_channel',
      resourceId: channel.id,
      details: { fields: Object.keys(parsed.data) },
    });
    return context.json(channel);
  });

  app.delete('/api/v1/notification-channels/:id', admin, async (context) => {
    await deleteChannel(options, context.req.param('id'));
    await audit(options, {
      actor: await actor(context),
      action: 'notification-channel.delete',
      resourceType: 'notification_channel',
      resourceId: context.req.param('id'),
    });
    return context.json({ ok: true });
  });

  app.post('/api/v1/notification-channels/:id/test', admin, async (context) => {
    const deliveryId = await queueTestDelivery(options, context.req.param('id'));
    await options.dispatchNow?.();
    const [delivery] = (await listDeliveries(options, 50)).filter((row) => row.id === deliveryId);
    return context.json({ delivery }, 202);
  });

  app.get('/api/v1/report-subscriptions', viewer, async (context) =>
    context.json({ subscriptions: await listSubscriptions(options) }),
  );

  app.post('/api/v1/report-subscriptions', operator, async (context) => {
    const parsed = CreateSubscriptionBodySchema.safeParse(await body(context));
    if (!parsed.success) throw invalid(parsed.error.issues);
    return context.json(await createSubscription(options, parsed.data), 201);
  });

  app.delete('/api/v1/report-subscriptions/:id', operator, async (context) => {
    await deleteSubscription(options, context.req.param('id'));
    return context.json({ ok: true });
  });

  app.get('/api/v1/report-deliveries', viewer, async (context) =>
    context.json({ deliveries: await listDeliveries(options) }),
  );

  app.get('/api/v1/report-preview', viewer, async (context) => {
    const days = context.req.query('window') === 'daily' ? 1 : 7;
    const audienceParam = context.req.query('audience');
    const audience =
      audienceParam === 'manager' ||
      audienceParam === 'sdet' ||
      audienceParam === 'quality' ||
      audienceParam === 'general'
        ? audienceParam
        : undefined;
    const model = await composeWorkspaceReportModel(options, {
      title: days === 1 ? 'Daily quality report' : 'Weekly quality report',
      windowDays: days,
      link: options.link,
      audience,
    });
    const preview: ReportPreview = { status: model.status, text: renderPlain(model, 2_000) };
    return context.json(preview);
  });

  // The full report as one self-contained HTML page — the `full` format, for a channel that
  // can carry it and for a person who wants the whole thing rather than the digest. Viewer-gated
  // like the preview and the cockpit report; `?window=daily|weekly`, `?audience=` tunes the
  // lens, `?download=1` offers it as a file. The page fetches nothing and runs no script.
  app.get('/api/v1/report.html', viewer, async (context) => {
    const days = context.req.query('window') === 'daily' ? 1 : 7;
    const audienceParam = context.req.query('audience');
    const audience =
      audienceParam === 'manager' ||
      audienceParam === 'sdet' ||
      audienceParam === 'quality' ||
      audienceParam === 'general'
        ? audienceParam
        : undefined;
    const model = await composeWorkspaceReportModel(options, {
      title: days === 1 ? 'Daily quality report' : 'Weekly quality report',
      windowDays: days,
      link: options.link,
      audience,
    });
    const html = renderFullReport(model, { generatedAt: new Date().toISOString() });
    context.header(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    context.header('x-content-type-options', 'nosniff');
    context.header('referrer-policy', 'no-referrer');
    context.header('cache-control', 'no-store');
    if (context.req.query('download') === '1') {
      const day = new Date().toISOString().slice(0, 10);
      context.header('content-disposition', `attachment; filename="lupin-report-${day}.html"`);
    }
    return context.html(html);
  });

  return app;
}
