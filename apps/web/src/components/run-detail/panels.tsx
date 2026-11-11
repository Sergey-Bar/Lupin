import React, { useState } from 'react';
import { Badge, Button, Hero, cn } from '@lupin/ui';
import { useRunDetail } from '../../hooks/useDashboard.js';
import { runHero } from '../../lib/hero.js';
import { retryLabel } from '../../lib/attention.js';
import { getArtifactUrl, type ApiClient, type Run } from '../../lib/api.js';
import { formatBytes } from '../../lib/format.js';
import { formatDuration } from '../../lib/insights.js';
import { describeGateReason } from '../../lib/gate-reason.js';
import { statusWord } from '../../lib/status-word.js';
import { Timestamp } from '../Timestamp.js';
import { Bdi } from '../Bidi.js';
import { Paged, Panel } from '../kit.js';
import { CopilotExplain } from '../CopilotExplain.js';
import { BranchHistory } from '../BranchHistory.js';
import { formatDate, PhaseTimeline, TestEvidence, isFailure } from './evidence.js';

/**
 * Run detail: the summary, evidence and gate panels, and the live hero. Moved out of
 * `routes/dashboard/run-detail.tsx`, which was 1,135 lines (ledger MNT-191).
 */

export type RunDetailState = ReturnType<typeof useRunDetail>;

/** Badge tone for a gate status. */
function gateTone(status: string): 'success' | 'danger' | 'warning' {
  if (status === 'passed') return 'success';
  return status === 'failed' ? 'danger' : 'warning';
}

/** Badge tone for a release-readiness decision. */
function readinessTone(decision: string): 'success' | 'danger' | 'warning' {
  if (decision === 'ready') return 'success';
  return decision === 'blocked' ? 'danger' : 'warning';
}

export function SummaryPanels({ run }: { run: Run }) {
  return (
    <>
      <div className="shrink-0 rounded-lg border border-border bg-surface-raised px-4 py-3">
        <PhaseTimeline phase={run.phase} />
      </div>

      <section aria-label="Execution summary" className="grid shrink-0 grid-cols-4 gap-2 sm:gap-3">
        <Figure label="Total" testId="run-total" value={String(run.summary.total)} />
        <Figure
          label="Passed"
          testId="run-passed"
          value={String(run.summary.passed)}
          tone="text-success"
        />
        <Figure
          label="Failed"
          testId="run-failed"
          value={String(run.summary.failed)}
          tone="text-danger"
        />
        <Figure
          label="Duration"
          testId="run-duration"
          value={run.summary.durationMs == null ? '—' : formatDuration(run.summary.durationMs)}
          hint={run.summary.durationMs == null ? 'Not reported' : undefined}
        />
      </section>
      <section
        aria-label="Run context"
        className="shrink-0 rounded-lg border border-border bg-surface-raised px-4 py-3"
      >
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 xl:grid-cols-9">
          {/*
            Project, environment and release are omitted when the run never had them — a
            reporter-sent run has none of the three — rather than drawn as Unknown. Branch,
            runner and the times stay, because their absence is itself the information.
          */}
          {run.projectId ? (
            <ContextItem label="Project" testId="run-project" value={run.projectId} />
          ) : null}
          {run.environmentId ? <ContextItem label="Environment" value={run.environmentId} /> : null}
          {/* Embedded: the board, rig or bench the run needed, then its labels. */}
          {run.requiredCapabilities.length + run.labels.length > 0 ? (
            <ContextItem
              label="Target"
              testId="run-target"
              value={<Bdi>{[...run.requiredCapabilities, ...run.labels].join(' · ')}</Bdi>}
            />
          ) : null}
          {run.releaseId ? <ContextItem label="Release" value={run.releaseId} /> : null}
          <ContextItem
            label="Branch / Commit"
            value={`${run.branch ?? '—'} / ${run.commit ?? '—'}`}
          />
          {run.framework && run.framework !== 'unknown' ? (
            <ContextItem label="Framework" value={run.framework} />
          ) : null}
          <ContextItem label="Runner" value={run.runner?.name ?? run.runner?.id ?? 'Unassigned'} />
          <ContextItem
            label="Created"
            value={<Timestamp value={run.createdAt} empty="Unknown" />}
          />
          <ContextItem
            label="Started"
            value={<Timestamp value={run.startedAt} empty="Unknown" />}
          />
          <ContextItem
            label="Finished"
            value={<Timestamp value={run.finishedAt} empty="Unknown" />}
          />
        </dl>
      </section>
      {run.error ? (
        <div
          data-testid="run-error-context"
          className="shrink-0 rounded-lg border border-danger px-4 py-2 text-sm"
        >
          <span className="font-semibold text-danger">{run.error.code}</span>{' '}
          <span>{run.error.message}</span>
        </div>
      ) : null}
    </>
  );
}

/**
 * How an evidence panel takes space. With evidence it fills its column so a long list scrolls
 * inside it; with none it is one sentence, and a full-height box around one sentence reads as a
 * missing page rather than as an answer. `self-start` because the test panel is a grid cell,
 * which stretches regardless of flex.
 */
function evidenceFit(hasEvidence: boolean): string {
  return hasEvidence ? 'flex-1' : 'flex-none self-start w-full';
}

export function TestPanel({ run }: { run: Run }) {
  return (
    <>
      <Panel title="Test attempts" className={evidenceFit(run.tests.length > 0)}>
        <div
          tabIndex={0}
          role="region"
          aria-label="Test attempt list"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {/* Inside the scroll region, so a long answer scrolls with the evidence it explains. */}
          {run.tests.some((test) => isFailure(test.status)) ? (
            <>
              <BranchHistory run={run} />
              <CopilotExplain runId={run.id} />
            </>
          ) : null}
          <TestEvidence tests={run.tests} />
        </div>
      </Panel>
    </>
  );
}

export function ArtifactPanel({
  artifacts,
  evidenceError,
}: {
  artifacts: RunDetailState['artifacts'];
  evidenceError: RunDetailState['evidenceError'];
}) {
  return (
    <>
      <Panel title="Artifacts" className={cn('min-h-0', evidenceFit(artifacts.length > 0))}>
        {evidenceError ? (
          <p className="max-w-measure text-pretty text-sm text-warning">
            Some artifact metadata could not be refreshed.
          </p>
        ) : null}
        {artifacts.length > 0 ? (
          <Paged items={artifacts} reservedPx={520} rowPx={56} headerPx={0} label="artifacts">
            {(page) => (
              <ul aria-label="Artifact list" className="divide-y divide-border-default">
                {page.map((artifact) => (
                  <li key={artifact.id} className="py-2">
                    <a
                      href={getArtifactUrl(artifact.id)}
                      className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {artifact.name ?? artifact.kind}
                    </a>
                    <div className="mt-0.5 truncate text-xs text-fg-muted">
                      {artifact.kind} · {formatBytes(artifact.sizeBytes)} ·{' '}
                      <span title={`SHA-256 ${artifact.checksum}`}>
                        SHA-256 {artifact.checksum.slice(0, 12)}…
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        ) : (
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            No persisted artifacts have been reported.
          </p>
        )}
      </Panel>
    </>
  );
}

export function EventPanel({ events }: { events: RunDetailState['events'] }) {
  return (
    <>
      <Panel title="Live event timeline" className={cn('min-h-0', evidenceFit(events.length > 0))}>
        {events.length > 0 ? (
          <div
            tabIndex={0}
            role="region"
            aria-label="Event list"
            className="min-h-0 flex-1 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <ol className="space-y-1.5">
              {events.map((event) => (
                <li
                  key={event.eventId}
                  className="flex justify-between gap-3 rounded-md bg-surface-sunken px-3 py-1.5 text-sm"
                >
                  <span className="truncate font-medium">{event.type}</span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    #{event.sequence} · {formatDate(event.occurredAt)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            No events have been observed in this browser session. Run state above is the
            authoritative API snapshot.
          </p>
        )}
      </Panel>
    </>
  );
}

export function GatePanel({
  gate,
  readiness,
}: {
  gate: RunDetailState['gate'];
  readiness: RunDetailState['readiness'];
}) {
  return (
    <>
      <Panel
        title="Quality gate"
        data-testid="run-gate"
        className={cn('min-h-0', evidenceFit(gate !== null && gate !== undefined))}
      >
        {gate ? (
          <>
            <Badge className="self-start" variant={gateTone(gate.status)}>
              {statusWord(gate.status)}
            </Badge>
            <div
              tabIndex={0}
              role="region"
              aria-label="Gate reasons"
              className="mt-2 min-h-0 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <ul className="space-y-1 break-words text-sm">
                {gate.reasons.map((reason, index) => (
                  <li key={`${reason}-${index}`} title={reason}>
                    {describeGateReason(reason)}
                  </li>
                ))}
              </ul>
            </div>
            {gate.evidenceRefs.length > 0 ? (
              <p className="mt-2 max-w-measure truncate text-xs text-fg-muted">
                Evidence: {gate.evidenceRefs.join(', ')}
              </p>
            ) : null}
          </>
        ) : (
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            Unknown: no gate has evaluated this run yet.
          </p>
        )}
      </Panel>
      {readiness ? (
        <Panel
          title="Release readiness"
          data-testid="run-readiness"
          action={
            <Badge variant={readinessTone(readiness.decision)}>
              {statusWord(readiness.decision)}
            </Badge>
          }
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {Object.entries(readiness.domains).map(([domain, status]) => (
              <div key={domain} className="flex justify-between gap-2">
                <span className="capitalize">{domain}</span>
                <span>{statusWord(status)}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
/** One summary figure, with the test id on the value itself so its text is exactly the number. */
function Figure({
  label,
  value,
  testId,
  tone,
  hint,
}: {
  label: string;
  value: string;
  testId: string;
  tone?: string;
  /** What a dash means, for a reader who hovers it. */
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-raised px-3 py-2 sm:px-4 sm:py-3">
      <div className="truncate text-xs font-medium text-fg-muted" title={label}>
        {label}
      </div>
      {/* A word ("Unknown") steps down a size on a phone, so four figures share one row. */}
      <div
        data-testid={testId}
        title={hint ?? value}
        className={`mt-1 truncate tabular-nums font-semibold sm:text-3xl ${value.length > 5 ? 'text-base' : 'text-xl'} ${tone ?? ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function ContextItem({
  label,
  value,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-fg-muted">{label}</dt>
      <dd
        data-testid={testId}
        className="m-0 break-words"
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The run as one verdict, Tesla-style. While it runs the hero counts what has reported (the
 * page already takes live events, so the numbers move as results arrive); when it ends it
 * settles into Passed or Failed, and a failed run offers one click that re-runs only the
 * tests that broke.
 */
export function LiveRunHero({
  run,
  api,
  onRetried,
}: {
  run: Run;
  api: ApiClient;
  onRetried: (id: string) => void;
}) {
  const hero = runHero(run);
  const [busy, setBusy] = useState(false);
  return (
    <Hero
      headingLevel={2}
      verdict={hero.verdict}
      word={hero.word}
      reason={hero.reason}
      eyebrow="This run"
    >
      {hero.verdict === 'no-go' && hero.failed > 0 ? (
        <div>
          <Button
            data-primary="true"
            aria-keyshortcuts="a"
            className="min-h-11"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api
                .retryRun(run.id, undefined, { scope: 'failed' })
                .then((next) => onRetried(next.id))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Retrying' : retryLabel(hero.failed)}
          </Button>
        </div>
      ) : null}
    </Hero>
  );
}
