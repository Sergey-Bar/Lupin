import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, Button, EmptyState, LiveDot, Status } from '@lupin/ui';
import type { CockpitWindow } from '@lupin/shared-contracts';
import { Route as dashboardRoute } from '../dashboard.js';
import { useRunDetail } from '../../hooks/useDashboard.js';
import { isRunActive } from '../../hooks/useRuns.js';
import { ApiError, defaultApiClient, type ApiClient, type Run } from '../../lib/api.js';
import { createCockpitClient, type CockpitClient } from '../../lib/cockpit-client.js';
import { runTransitionName } from '../../lib/view-transition.js';
import { Bdi } from '../../components/Bidi.js';
import { PageFrame, PageHeader } from '../../components/kit.js';
import { Responsive } from '../../components/responsive.js';
import { ScoreImpactBanner } from '../../components/ScoreImpactBanner.js';
import { RunVerdict } from '../../components/run-detail/evidence.js';
import {
  type RunDetailState,
  SummaryPanels,
  TestPanel,
  ArtifactPanel,
  EventPanel,
  GatePanel,
  LiveRunHero,
} from '../../components/run-detail/panels.js';

/**
 * `?from=cockpit&window=` is how the cockpit says it sent the person here. It is the only
 * thing that makes this page ask the cockpit anything, so a run opened from the runs list, a
 * link in a message or a bookmark costs what it always did.
 */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/runs/$runId',
  validateSearch: (
    search: Record<string, unknown>,
  ): { from?: 'cockpit'; window?: CockpitWindow } =>
    search['from'] === 'cockpit'
      ? { from: 'cockpit', window: search['window'] === 'release' ? 'release' : '7d' }
      : {},
  component: () => {
    const { runId } = Route.useParams();
    const { from, window } = Route.useSearch();
    return (
      <RunDetailPage
        id={runId}
        {...(from === 'cockpit' ? { scoreContext: { window: window ?? '7d' } } : {})}
      />
    );
  },
});

export function RunDetailPage({
  id,
  api,
  scoreContext,
  cockpit,
}: {
  id: string;
  api?: ApiClient;
  /** Present when the person came from the cockpit: the window it was showing. */
  scoreContext?: { window: CockpitWindow };
  /** Reads the cockpit for {@link ScoreImpactBanner}; defaults to the real one. */
  cockpit?: CockpitClient['getCockpit'];
}) {
  const {
    run,
    artifacts,
    gate,
    readiness,
    events,
    evidenceError,
    isLoading,
    error,
    actionError,
    isActing,
    isLive,
    cancel,
    retry,
  } = useRunDetail(id, api);
  const [retryTarget, setRetryTarget] = useState<string | null>(null);

  if (isLoading) return <RunDetailLoading id={id} />;

  if (error) return <RunDetailError error={error} id={id} />;

  // A type guard, and nothing more: every line below narrows `run`, so this
  // cannot be deleted without a typecheck error. It is also currently `unreachable` —
  // `useRunDetail` dereferences `run.releaseId` straight after the fetch
  // (`hooks/useDashboard.ts:131`), so a null run raises a TypeError inside the hook
  // and arrives here as an error, not as an empty run. Ledger W-6's other claim is
  // therefore half wrong, and the half that is right — matching a 404 on the status
  // instead of on the server's English prose — is fixed above. Making this state
  // reachable means optional-chaining the hook first; that is not done here, so this
  // guard keeps its original shape rather than gaining a branch no test can reach.
  if (run === null) return null;

  const performCancel = async () => {
    try {
      await cancel();
    } catch {
      return;
    }
  };

  const performRetry = async () => {
    try {
      const next = await retry();
      setRetryTarget(next.id);
    } catch {
      return;
    }
  };

  const summary = <SummaryPanels run={run} />;
  const tests = <TestPanel run={run} />;
  const artifactPanel = <ArtifactPanel artifacts={artifacts} evidenceError={evidenceError} />;
  const eventPanel = <EventPanel events={events} />;
  const gatePanel = <GatePanel gate={gate} readiness={readiness} />;
  return (
    <PageFrame data-testid="run-detail-page">
      <RunHeader
        run={run}
        isLive={isLive}
        isActing={isActing}
        onCancel={() => void performCancel()}
        onRetry={() => void performRetry()}
      />
      <LiveRunHero run={run} api={api ?? defaultApiClient} onRetried={setRetryTarget} />
      <ActionNotice actionError={actionError} retryTarget={retryTarget} />
      {scoreContext === undefined ? null : (
        <ScoreImpactBanner
          runId={run.id}
          commit={run.commit ?? null}
          window={scoreContext.window}
          projectId={run.projectId ?? undefined}
          getCockpit={cockpit ?? defaultCockpit}
        />
      )}

      <RunVerdict run={run} gate={gate} />

      <Responsive
        label="Run sections"
        desktop={
          <>
            {summary}
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
              {tests}
              <div className="flex min-h-0 flex-col gap-3">
                {artifactPanel}
                {eventPanel}
              </div>
              <div className="flex min-h-0 flex-col gap-3">{gatePanel}</div>
            </div>
          </>
        }
        panels={[
          {
            id: 'summary',
            label: 'Summary',
            node: <div className="flex min-h-0 flex-1 flex-col gap-3">{summary}</div>,
          },
          { id: 'tests', label: 'Tests', node: tests },
          { id: 'artifacts', label: 'Artifacts', node: artifactPanel },
          { id: 'events', label: 'Events', node: eventPanel },
          {
            id: 'gate',
            label: 'Gate',
            node: <div className="flex min-h-0 flex-1 flex-col gap-3">{gatePanel}</div>,
          },
        ]}
      />
    </PageFrame>
  );
}

/** One client for the page's life: the banner's read must not change with every render. */
const defaultCockpit: CockpitClient['getCockpit'] = (query, signal) =>
  createCockpitClient().getCockpit(query, signal);

function RunDetailLoading({ id }: { id: string }) {
  return (
    <PageFrame>
      <PageHeader title="Run detail" />
      <div data-testid="run-detail-loading" className="text-sm text-fg-muted">
        Reading run {id}…
      </div>
    </PageFrame>
  );
}

/**
 * On the status, not on the message. The API already sends a distinct code and
 * status for this — `DomainError('RUN_NOT_FOUND')` renders as
 * `{ error: { code, message, requestId } }` with a 404 — and the old check read
 * `error.message` looking for the words "not found". It worked only because the
 * server's English prose happened to contain them: translate the string, or
 * reword it, and the run silently becomes a generic error (ledger W-6).
 *
 * The hook types this as `Error` while the value it stores is an `ApiError`, so
 * the status is read through an `instanceof` check rather than a cast. An error
 * that is not an `ApiError` carries no status to read, and falls through to the
 * generic state, which is the honest answer for an error of unknown provenance.
 */
function RunDetailError({ error, id }: { error: Error; id: string }) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <PageFrame>
        <PageHeader title="Run detail" />
        <EmptyState
          headingLevel={2}
          data-testid="run-not-found"
          title="Run not found"
          description={`No canonical run exists for ${id}.`}
        />
      </PageFrame>
    );
  }
  return (
    <PageFrame>
      <PageHeader title="Run detail" />
      <EmptyState
        headingLevel={2}
        data-testid="run-error"
        title="Run unavailable"
        description={error.message}
      />
    </PageFrame>
  );
}

function RunHeader({
  run,
  isLive,
  isActing,
  onCancel,
  onRetry,
}: {
  run: Run;
  isLive: boolean;
  isActing: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <a
          href="/dashboard/runs"
          className="inline-flex min-h-11 items-center rounded-sm text-sm text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
            ←
          </span>{' '}
          Runs
        </a>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Run <span className="font-mono">{run.id.slice(0, 8)}</span>
        </h1>
        <div
          className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted"
          style={{ viewTransitionName: runTransitionName(run.id) }}
        >
          {run.branch || run.commit ? (
            <span data-testid="run-ref" className="truncate font-mono text-fg">
              <Bdi>{[run.branch, run.commit?.slice(0, 7)].filter(Boolean).join(' · ')}</Bdi>
            </span>
          ) : null}
          {run.suite ? <span className="truncate font-mono text-fg">{run.suite}</span> : null}
          <span data-testid="run-id" className="truncate font-mono text-xs">
            {run.id}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LiveDot live={isLive} />
        {/* The phase as the API spells it: a precise, quiet label beside the verdict. */}
        <Badge data-testid="run-phase" variant={isRunActive(run) ? 'default' : 'outline'}>
          {run.phase}
        </Badge>
        <Status data-testid="run-status" size="lg" state={run.outcome} />
        {isRunActive(run) ? (
          <Button
            data-testid="cancel-run"
            variant="destructive"
            disabled={isActing}
            onClick={onCancel}
            className="min-h-11"
          >
            Cancel run
          </Button>
        ) : null}
        {!isRunActive(run) && run.outcome !== 'passed' ? (
          <Button
            data-testid="retry-run"
            variant="secondary"
            disabled={isActing}
            onClick={onRetry}
            className="min-h-11"
          >
            Retry run
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function ActionNotice({
  actionError,
  retryTarget,
}: {
  actionError: RunDetailState['actionError'];
  retryTarget: string | null;
}) {
  if (!actionError && !retryTarget) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
      {actionError ? (
        <p role="alert" className="max-w-measure text-danger">
          {actionError.message}
        </p>
      ) : null}
      {retryTarget ? (
        <a
          data-testid="retry-run-link"
          href={`/dashboard/runs/${encodeURIComponent(retryTarget)}`}
          className="rounded-sm text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Open retried run {retryTarget}
        </a>
      ) : null}
    </div>
  );
}
