/**
 * quality-gates.ts — the quality gate store and its routes.
 *
 * The body is validated by `CreateQualityGateBodySchema` rather than by three
 * hand-rolled field checks against an `as Record<string, unknown>` assertion. See
 * `schemas.ts`: an empty body used to throw out of the handler and surface as a 500,
 * and the assertion meant the "type" of the body was never actually checked.
 */

import { Hono, type Context } from 'hono';
import { DomainError, ErrorCode } from '../../errors/domain-error.js';
import { randomUUID } from 'node:crypto';
import { InMemoryAuditSink, type AuditEntry, type WriteContext } from './audit-sink.js';
import { CreateQualityGateBodySchema, UpdateQualityGateBodySchema } from './schemas.js';
import { currentRequestId } from '../../observability/request-context.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface QualityGate {
  id: string;
  name: string;
  /** Required pass rate (0–100) for a run to pass this gate */
  passRateThreshold: number;
  createdAt: string; // ISO-8601
  /**
   * `installation`: every workspace shares the row (`workspace_id` NULL), so only an
   * installation admin may change it. `workspace`: the row belongs to the workspace reading it.
   */
  scope: QualityGateScope;
}

export type QualityGateScope = 'installation' | 'workspace';

/** A gate as it arrives from a caller: no id, no timestamp, and no say over its scope. */
export type NewQualityGate = Omit<QualityGate, 'id' | 'createdAt' | 'scope'>;

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface QualityGateStore {
  /** The installation-wide gates and this workspace's own; never another workspace's. */
  list(): Promise<QualityGate[]>;
  /** Creates an installation-wide gate, the only kind the dashboard creates. */
  add(gate: NewQualityGate, context?: WriteContext): Promise<QualityGate>;
  get(id: string): Promise<QualityGate | null>;
  /** The updated gate, or `null` when there is none with this id. */
  update(
    id: string,
    patch: Partial<NewQualityGate>,
    context?: WriteContext,
  ): Promise<QualityGate | null>;
  /** Whether a gate was removed. */
  remove(id: string, context?: WriteContext): Promise<boolean>;
}

/** The installation-wide default gate: edited, never removed, because every evaluation falls back to it. */
export const DEFAULT_GATE_ID = 'global';

export class InMemoryQualityGateStore implements QualityGateStore {
  private readonly _gates = new Map<string, QualityGate>();

  /** @param initial gates already present, for a test that needs a workspace's own gate. */
  constructor(
    initial: readonly QualityGate[] = [],
    private readonly audit: InMemoryAuditSink = new InMemoryAuditSink(),
  ) {
    for (const gate of initial) this._gates.set(gate.id, { ...gate });
  }

  /** The creations this store recorded. Read by tests to assert attribution. */
  get recorded(): readonly AuditEntry[] {
    return this.audit.entries;
  }

  async list(): Promise<QualityGate[]> {
    return Array.from(this._gates.values());
  }

  async add(gate: NewQualityGate, context?: WriteContext): Promise<QualityGate> {
    const id = randomUUID();
    const g: QualityGate = {
      ...gate,
      id,
      createdAt: new Date().toISOString(),
      scope: 'installation',
    };
    this._gates.set(id, g);
    await this.audit.record({
      action: 'quality_gate.created',
      resourceType: 'quality_gate',
      resourceId: id,
      ...(context ?? { actorId: 'system', actorType: 'system' as const }),
      details: { name: gate.name, passRateThreshold: gate.passRateThreshold },
    });
    return g;
  }

  async get(id: string): Promise<QualityGate | null> {
    return this._gates.get(id) ?? null;
  }

  async update(
    id: string,
    patch: Partial<NewQualityGate>,
    context?: WriteContext,
  ): Promise<QualityGate | null> {
    const existing = this._gates.get(id);
    if (existing === undefined) return null;
    const next = { ...existing, ...patch };
    this._gates.set(id, next);
    await this.audit.record({
      action: 'quality_gate.updated',
      resourceType: 'quality_gate',
      resourceId: id,
      ...(context ?? { actorId: 'system', actorType: 'system' as const }),
      details: { ...patch },
    });
    return next;
  }

  async remove(id: string, context?: WriteContext): Promise<boolean> {
    if (!this._gates.delete(id)) return false;
    await this.audit.record({
      action: 'quality_gate.deleted',
      resourceType: 'quality_gate',
      resourceId: id,
      ...(context ?? { actorId: 'system', actorType: 'system' as const }),
      details: {},
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface DashboardQualityGatesOptions {
  store: QualityGateStore;
  /**
   * Who to attribute a write to. `'anonymous'` by default, which is what an
   * unauthenticated write is — a recorded value, not an omission.
   */
  contextFor?: (c: Context) => WriteContext | Promise<WriteContext>;
  /**
   * Whether this caller may change what every workspace shares: an installation admin, the
   * rule `mayChangeInstallation` applies to install-scoped settings. Required, so a
   * composition cannot forget it and leave a shared gate open to every workspace's admin
   * (ledger MNT-170).
   */
  mayChangeInstallation: (c: Context) => Promise<boolean>;
}

const INSTALLATION_GATE_FIX =
  'Every workspace shares this gate. Ask an installation admin to change it.';

async function refuseSharedWrite(
  options: DashboardQualityGatesOptions,
  c: Context,
  scope: QualityGateScope,
): Promise<void> {
  if (scope === 'workspace' || (await options.mayChangeInstallation(c))) return;
  throw new DomainError(
    ErrorCode.INSTALLATION_ADMIN_REQUIRED,
    'Only an installation admin can change a gate every workspace shares.',
    { details: { fix: INSTALLATION_GATE_FIX } },
  );
}

/**
 * The audit context for a write with no authenticated principal.
 *
 * The request is not an input: the id comes from the request context, so there is
 * nothing here for a caller to supply and nothing that can disagree (ledger O-1b).
 * Outside a request — a test, a background job — the id is absent rather than
 * invented, because a fabricated correlatable-looking id in an audit row is worse than
 * a missing one.
 */
function defaultContext(): WriteContext {
  return {
    actorId: 'anonymous',
    actorType: 'user',
    requestId: currentRequestId() ?? null,
  };
}

export function createDashboardQualityGatesRoutes(options: DashboardQualityGatesOptions): Hono {
  const app = new Hono();
  const contextFor = options.contextFor ?? defaultContext;

  // ── GET /api/v1/dashboard/quality-gates ──────────────────────────────────
  app.get('/api/v1/dashboard/quality-gates', async (c) => {
    const gates = await options.store.list();
    return c.json(gates);
  });

  // ── POST /api/v1/dashboard/quality-gates ─────────────────────────────────
  app.post('/api/v1/dashboard/quality-gates', async (c) => {
    // `.catch(() => null)`: `req.json()` throws on an empty or malformed body, and
    // the throw used to escape as a 500 — indistinguishable from a real fault, with
    // the validation below never having run.
    const body = await c.req.json().catch(() => null);
    const parsed = CreateQualityGateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('INVALID_QUALITY_GATE', 'Invalid quality gate', {
        details: { issues: parsed.error.issues },
      });
    }
    // Every gate the dashboard creates is installation-wide (`workspace_id` NULL).
    await refuseSharedWrite(options, c, 'installation');

    const gate = await options.store.add(parsed.data, await contextFor(c));
    return c.json(gate, 201);
  });

  // ── GET /api/v1/dashboard/quality-gates/:id ──────────────────────────────
  app.get('/api/v1/dashboard/quality-gates/:id', async (c) => {
    const id = c.req.param('id');
    const gate = await options.store.get(id);
    if (!gate) {
      throw new DomainError('QUALITY_GATE_NOT_FOUND', 'Quality gate not found');
    }
    return c.json(gate);
  });

  // PATCH /api/v1/dashboard/quality-gates/:id
  app.patch('/api/v1/dashboard/quality-gates/:id', async (c) => {
    const parsed = UpdateQualityGateBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError('INVALID_QUALITY_GATE', 'Invalid quality gate', {
        details: { issues: parsed.error.issues, fix: 'Use a pass rate between 0 and 100.' },
      });
    }
    const patch: Partial<NewQualityGate> = {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.passRateThreshold === undefined
        ? {}
        : { passRateThreshold: parsed.data.passRateThreshold }),
    };
    const id = c.req.param('id');
    const existing = await options.store.get(id);
    if (!existing) throw new DomainError('QUALITY_GATE_NOT_FOUND', 'Quality gate not found');
    await refuseSharedWrite(options, c, existing.scope);
    const gate = await options.store.update(id, patch, await contextFor(c));
    if (!gate) throw new DomainError('QUALITY_GATE_NOT_FOUND', 'Quality gate not found');
    return c.json(gate);
  });

  // DELETE /api/v1/dashboard/quality-gates/:id
  app.delete('/api/v1/dashboard/quality-gates/:id', async (c) => {
    const id = c.req.param('id');
    if (id === DEFAULT_GATE_ID) {
      throw new DomainError('CONFLICT', 'The installation default gate cannot be removed.', {
        details: { fix: 'Change its threshold instead; every evaluation falls back to it.' },
      });
    }
    const existing = await options.store.get(id);
    if (!existing) throw new DomainError('QUALITY_GATE_NOT_FOUND', 'Quality gate not found');
    await refuseSharedWrite(options, c, existing.scope);
    if (!(await options.store.remove(id, await contextFor(c)))) {
      throw new DomainError('QUALITY_GATE_NOT_FOUND', 'Quality gate not found');
    }
    return c.json({ ok: true });
  });

  return app;
}
