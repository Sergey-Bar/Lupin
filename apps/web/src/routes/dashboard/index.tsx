import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  StatusDot,
  Hero,
} from '@lupin/ui';
import { areaHero } from '../../lib/hero.js';
import { Route as dashboardRoute } from '../dashboard.js';
import { LaunchRunForm, ReleaseReadinessCard } from '../dashboard.js';
import {
  PageFrame,
  PageHeader,
  Panel,
  PagerControls,
  usePager,
  useFitCount,
} from '../../components/kit.js';
import { isRunActive, useRuns } from '../../hooks/useRuns.js';
import { defaultApiClient, type ApiClient, type Run } from '../../lib/api.js';
import { Timestamp } from '../../components/Timestamp.js';
import { formatDuration } from '../../lib/insights.js';
import { runDetailPath } from '../../route-manifest.js';
import { AreaPage, type AreaItem } from '../../components/AreaPage.js';
import { STUCK_MS, failedTests, failureTitle, retryLabel } from '../../lib/attention.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/runs',
  component: () => <RunsListPage />,
});

function outcomeVariant(
  outcome: Run['outcome'],
): 'success' | 'danger' | 'warning' | 'default' | 'secondary' {
  switch (outcome) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'partial':
    case 'unknown':
      return 'warning';
    default:
      return 'secondary';
  }
}

/**
 * What the Runs area asks of a reader: each branch whose **newest** run is red, with one
 * click that retries just the tests that broke, then any run that has been going for over an
 * hour. A branch that went red and then green again is not asked about; it is already fixed.
 */
export function runAreaItems(
  runs: readonly Run[],
  api: Pick<ApiClient, 'retryRun'>,
  now: Date,
): AreaItem[] {
  // A branch is judged by its newest *finished* run: a queued or cancelled retry says
  // nothing about whether the code is green, and must not hide the red run behind it.
  const newest = new Map<string, Run>();
  const ordered = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const run of ordered) {
    if (run.outcome === null || run.outcome === 'cancelled') continue;
    const key = run.branch ?? run.suite ?? run.id;
    if (!newest.has(key)) newest.set(key, run);
  }
  const red: AreaItem[] = [];
  const stuck: AreaItem[] = [];
  for (const run of newest.values()) {
    const at = run.completedAt ?? run.startedAt ?? run.createdAt;
    if (run.outcome === 'failed' || run.outcome === 'blocked') {
      const failed = failedTests(run);
      red.push({
        id: `run-${run.id}`,
        title: failureTitle(run),
        detail: run.suite ?? (run.branch === null ? 'Latest run' : 'Latest run on this branch'),
        tone: 'bad',
        at,
        action: {
          label: retryLabel(failed),
          busyLabel: 'Retrying',
          run: async () => {
            await api.retryRun(run.id, undefined, { scope: failed > 0 ? 'failed' : 'all' });
          },
        },
      });
    }
  }
  // Running runs have no outcome, so they are looked at apart from the per-branch verdict.
  for (const run of ordered) {
    if (
      run.phase === 'running' &&
      run.startedAt !== null &&
      now.getTime() - new Date(run.startedAt).getTime() > STUCK_MS
    ) {
      stuck.push({
        id: `run-${run.id}`,
        title: `${run.branch ?? run.suite ?? run.testType} has been running over an hour`,
        detail: 'It may be stuck',
        tone: 'warn',
        at: run.startedAt,
        action: { label: 'Open run', to: runDetailPath(run.id) },
      });
    }
  }
  return [...red, ...stuck];
}

export function runVerdict(count: number): string {
  if (count === 0) return 'Every branch is green.';
  return count === 1 ? 'One branch needs you.' : `${String(count)} branches need you.`;
}

/**
 * Every run, paged into the viewport, with readiness and the live feed beside it.
 *
 * The launch form is a dialog rather than a block above the table: eight fields above the
 * evidence made the page a form you had to scroll past to read anything, and the redesign's
 * rule is that a screen fits. It stays mounted while closed, so its state survives a
 * close-and-reopen and the idempotency key it holds is not minted twice for one run.
 */
export function RunsListPage({
  api = defaultApiClient,
  navigate = (to) => window.location.assign(to),
  now = () => new Date(),
}: {
  api?: ApiClient;
  navigate?: (to: string) => void;
  now?: () => Date;
}) {
  const { runs, isLoading, error, isLive, refresh } = useRuns(api);
  const [launching, setLaunching] = React.useState(false);
  // The table measures its own panel: a row is ~56px under a ~44px head.
  const [size, tableBox] = useFitCount(56, 8, 44);
  const pager = usePager(runs, size);
  const showProject = runs.some((run) => run.projectId != null);
  const showDuration = runs.some((run) => run.summary.durationMs != null);
  const latestReleaseId = runs.find((run) => run.releaseId)?.releaseId ?? null;

  if (isLoading) {
    return (
      <div
        data-testid="runs-list-loading"
        role="status"
        aria-label="Loading runs"
        className="space-y-3"
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <PageFrame>
        <PageHeader title="Runs" />
        <EmptyState
          headingLevel={2}
          data-testid="runs-list-error"
          title="Runs unavailable"
          description="Lupin could not load your runs. Try again. If this continues, ask the installation owner to check the API service and its logs."
          action={
            <div className="space-y-3">
              <Button onClick={() => void refresh()}>Try loading runs again</Button>
              <details className="text-sm text-fg-muted">
                <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
                  Technical details
                </summary>
                <p className="mt-2">{error.message}</p>
              </details>
            </div>
          }
        />
      </PageFrame>
    );
  }

  const passed = runs.filter((run) => run.outcome === 'passed').length;
  const failed = runs.filter((run) => run.outcome === 'failed').length;
  const active = runs.filter(isRunActive).length;

  const table = (
    <>
      {runs.length === 0 ? (
        <EmptyState
          headingLevel={2}
          data-testid="runs-list-empty"
          title="No execution evidence"
          description="Start a tool from the Runner, launch a browser run, or let the dashboard show what is blocking you."
          action={
            <a
              href="/dashboard/runner"
              className="rounded-md bg-primary px-4 py-2 text-sm text-on-fill no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Open the runner
            </a>
          }
        />
      ) : (
        <Panel title="All runs" data-testid="runs-table">
          {/*
            A column no run fills is a column of dashes. Reporter-sent runs carry neither a
            project nor a duration, so both columns appear only once some run has one.
          */}
          <div ref={tableBox} className="min-h-0 flex-1 overflow-hidden">
            <Table aria-label="Runs">
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  {showProject ? (
                    <TableHead className="hidden lg:table-cell">Project</TableHead>
                  ) : null}
                  <TableHead className="hidden md:table-cell">Phase</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  {showDuration ? (
                    <TableHead className="hidden sm:table-cell">Duration</TableHead>
                  ) : null}
                  <TableHead>Tests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((run) => (
                  <TableRow key={run.id} data-testid={`run-row-${run.id}`}>
                    <TableCell>
                      <a
                        href={runDetailPath(run.id)}
                        className="inline-flex min-h-6 items-center rounded-sm font-mono text-xs text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                      >
                        {run.suite ?? run.id.slice(0, 8)}
                      </a>
                    </TableCell>
                    {showProject ? (
                      <TableCell className="hidden lg:table-cell">{run.projectId ?? '—'}</TableCell>
                    ) : null}
                    <TableCell className="hidden md:table-cell">
                      {/* A polite live region on the badge alone, so a status flip is spoken
                          without re-reading the row. */}
                      <Badge
                        data-testid={`run-status-${run.id}`}
                        role="status"
                        aria-live="polite"
                        variant={isRunActive(run) ? 'default' : 'outline'}
                      >
                        {run.phase}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        data-testid={`run-outcome-${run.id}`}
                        variant={outcomeVariant(run.outcome)}
                      >
                        {run.outcome ?? 'PENDING'}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Timestamp value={run.createdAt} empty="Not started" />
                    </TableCell>
                    {showDuration ? (
                      <TableCell numeric className="hidden sm:table-cell">
                        {run.summary.durationMs != null
                          ? formatDuration(run.summary.durationMs)
                          : '—'}
                      </TableCell>
                    ) : null}
                    <TableCell numeric>
                      {run.summary.total > 0
                        ? `${run.summary.passed}/${run.summary.total}`
                        : 'No tests reported'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PagerControls pager={pager} label="run" />
        </Panel>
      )}
    </>
  );
  const readiness = <ReleaseReadinessCard releaseId={latestReleaseId} api={api} />;
  const headerActions = (
    <>
      <span
        data-testid="runs-live-state"
        className="inline-flex items-center gap-2 text-xs text-fg-muted"
      >
        <StatusDot status={isLive ? 'good' : 'unknown'} live={isLive} />
        {isLive ? 'Live' : 'Reconnecting'}
      </span>
      <Button data-testid="launch-run-open" onClick={() => setLaunching(true)} className="min-h-11">
        New browser run
      </Button>
    </>
  );
  const launch = (
    <Dialog
      open={launching}
      onOpenChange={setLaunching}
      aria-label="Launch browser run"
      className="max-w-2xl"
    >
      <DialogContent>
        <DialogClose label="Close" />
        <LaunchRunForm
          api={api}
          onCreated={() => {
            void refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
  const subtitle = 'Every run Lupin has received, newest first.';

  if (runs.length === 0) {
    return (
      <PageFrame data-testid="runs-list-page">
        <PageHeader title="Runs" subtitle={subtitle} actions={headerActions} />
        {table}
        {readiness}
        {launch}
      </PageFrame>
    );
  }

  const items = runAreaItems(runs, api, now());
  const red = items.filter((item) => item.tone === 'bad').length;
  const warn = items.filter((item) => item.tone === 'warn').length;
  const runsHero = areaHero({ bad: red, warn }, runVerdict(red));
  return (
    <>
      <AreaPage
        title="Runs"
        subtitle={subtitle}
        verdict={runVerdict(red)}
        hero={
          <Hero
            headingLevel={2}
            verdict={runsHero.verdict}
            word={runsHero.word}
            reason={runsHero.reason}
            facts={[
              { label: 'Failed', value: String(failed), testId: 'stat-failed' },
              { label: 'Passed', value: String(passed), testId: 'stat-passed' },
              { label: 'Running', value: String(active), testId: 'stat-running' },
              { label: 'Total', value: String(runs.length), testId: 'stat-total' },
            ]}
            eyebrow="Latest run on every branch"
          />
        }
        items={items}
        navigate={navigate}
        clear="Nothing to retry. The newest run on every branch passed."
        detailsOpen
        detailsTitle="Every run"
        actions={headerActions}
        details={
          // One list, the full width: the counts are in the status band above. The release's
          // own gate evidence follows the list (the release-readiness E2E reads it here); the
          // side column and its second, shorter run list are gone.
          <div className="flex flex-col gap-3">
            <div data-testid="runs-list-page" className="flex h-[70vh] min-h-96 flex-col">
              {table}
            </div>
            {readiness}
          </div>
        }
      />
      {launch}
    </>
  );
}
