import React from 'react';
import { cn } from '@lupin/ui';
import type {
  PhaseState,
  PhaseStrip,
  PortfolioPhases,
  RepositoryPhases,
  SdlcPhase,
  Shape,
} from '@lupin/shared-contracts';
import type { Resource } from '../hooks/useResource.js';
import { UserText } from './Bidi.js';
import { Panel } from './kit.js';

/**
 * The SDLC phases on screen: one pull request's strip, a repository's band, and the portfolio's
 * grid. Each phase is a word and a colour, never a colour alone, and a phase with no evidence
 * says "Not measured" rather than drawing as done.
 */

export const PHASE_LABEL: Readonly<Record<SdlcPhase, string>> = {
  plan: 'Plan',
  code: 'Code',
  test: 'Test',
  review: 'Review',
  release: 'Release',
};

const STATE_WORD: Readonly<Record<PhaseState, string>> = {
  done: 'Done',
  in_progress: 'In progress',
  pending: 'Not yet',
  skipped: 'Skipped',
  not_measured: 'Not measured',
};

export const SHAPE_WORD: Readonly<Record<Shape, string>> = {
  good: 'Good',
  caution: 'Caution',
  bad: 'Bad',
  unknown: 'Not measured',
};

export const SHAPE_TONE: Readonly<Record<Shape, string>> = {
  good: 'bg-success/10 text-success',
  caution: 'bg-warning/10 text-warning',
  bad: 'bg-danger/10 text-danger',
  unknown: 'bg-surface-muted text-fg-muted',
};

const hoursText = (hours: number | null) =>
  hours === null
    ? null
    : hours >= 48
      ? `${String(Math.round(hours / 24))} d`
      : `${String(hours)} h`;

/** One pull request's five phases, in order, each with its state, its time and its reason. */
export function PhaseStripView({ strip }: { strip: PhaseStrip }): React.ReactElement {
  return (
    <ol aria-label="SDLC phases" className="grid gap-2 sm:grid-cols-5">
      {strip.phases.map((step) => (
        <li
          key={step.phase}
          className={cn('flex flex-col gap-1 rounded-md p-3 text-sm', SHAPE_TONE[step.shape])}
        >
          <span className="text-xs font-medium">{PHASE_LABEL[step.phase]}</span>
          <span className="font-medium">
            {STATE_WORD[step.state]}
            {hoursText(step.hours) === null ? '' : ` · ${hoursText(step.hours) ?? ''}`}
          </span>
          <UserText className="text-xs text-fg-muted">{step.reason}</UserText>
        </li>
      ))}
    </ol>
  );
}

/** The strip's panel, for a pull request page: the strip, or why it is not there. */
export function PhaseStripPanel({ strip }: { strip: Resource<PhaseStrip> }): React.ReactElement {
  return (
    <Panel title="Phases" data-testid="pr-phases">
      {strip.status === 'loading' ? (
        <p className="max-w-measure text-sm text-fg-muted">Reading the phases…</p>
      ) : strip.status === 'error' ? (
        <p className="max-w-measure text-sm text-fg-muted">{strip.message}</p>
      ) : (
        <PhaseStripView strip={strip.value} />
      )}
    </Panel>
  );
}

/** A repository's phases: the bottleneck, each phase rolled up, and what is stuck. */
export function PhaseBandPanel({
  phases,
}: {
  phases: Resource<RepositoryPhases>;
}): React.ReactElement {
  return (
    <Panel title="Phases" data-testid="repo-360-phases">
      {phases.status === 'loading' ? (
        <p className="max-w-measure text-sm text-fg-muted">Reading the phases…</p>
      ) : phases.status === 'error' ? (
        <p role="alert" className="max-w-measure text-sm text-danger">
          The phases could not be read: {phases.message}
        </p>
      ) : (
        <BandBody read={phases.value} />
      )}
    </Panel>
  );
}

function BandBody({ read }: { read: RepositoryPhases }): React.ReactElement {
  if (!read.configured) {
    return (
      <p className="max-w-measure text-sm text-fg-muted">
        No pull request has been read: turn on delivery sync for this repository.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-measure text-sm text-fg">
        {read.bottleneck?.sentence ??
          `No phase is holding changes up across ${String(read.changes)} changes in ${String(read.windowDays)} days.`}
      </p>
      {read.truncated ? (
        <p className="max-w-measure text-xs text-warning">
          More changes were in the window than were read; every count is a lower bound.
        </p>
      ) : null}
      <ol aria-label="Each phase across the changes" className="grid gap-2 sm:grid-cols-5">
        {read.phases.map((entry) => (
          <li
            key={entry.phase}
            className={cn('flex flex-col gap-1 rounded-md p-3 text-sm', SHAPE_TONE[entry.shape])}
          >
            <span className="text-xs font-medium">{PHASE_LABEL[entry.phase]}</span>
            <span className="font-medium">{SHAPE_WORD[entry.shape]}</span>
            <span className="text-xs text-fg-muted">{entry.reason}</span>
            {entry.medianHours === null ? null : (
              <span className="text-xs tabular-nums text-fg-muted">
                Median {hoursText(entry.medianHours)}
              </span>
            )}
          </li>
        ))}
      </ol>
      {read.stuck.length === 0 ? null : (
        <div>
          <h3 className="mb-1 text-xs font-medium text-fg-muted">Stuck, longest first</h3>
          <ul data-page="" aria-label="Stuck changes" className="flex flex-col gap-1 text-sm">
            {read.stuck.map((entry) => (
              <li key={`${String(entry.pullRequest)}-${entry.phase}`} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-fg-muted">
                  #{String(entry.pullRequest)}
                </span>
                <UserText className="min-w-0 truncate text-fg">{entry.title}</UserText>
                <span className="ms-auto shrink-0 text-fg-muted">
                  {PHASE_LABEL[entry.phase]} · {hoursText(entry.hours)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Every repository by phase, worst first: which phase is failing where. */
export function PortfolioPhasesPanel({
  phases,
}: {
  phases: Resource<PortfolioPhases>;
}): React.ReactElement {
  return (
    <Panel
      title="Phases by repository"
      data-testid="portfolio-phases"
      scrollLabel="Phases by repository"
    >
      {phases.status === 'loading' ? (
        <p className="max-w-measure text-sm text-fg-muted">Reading the phases…</p>
      ) : phases.status === 'error' ? (
        <p role="alert" className="max-w-measure text-sm text-danger">
          The phases could not be read: {phases.message}
        </p>
      ) : (
        <PortfolioTable read={phases.value} />
      )}
    </Panel>
  );
}

function PortfolioTable({ read }: { read: PortfolioPhases }): React.ReactElement {
  if (read.projects.length === 0) {
    return <p className="max-w-measure text-sm text-fg-muted">No repository is registered yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Each repository’s shape per SDLC phase, over {String(read.windowDays)} days, worst first
        </caption>
        <thead>
          <tr className="text-xs text-fg-muted">
            <th scope="col" className="pe-3 text-start font-medium">
              Repository
            </th>
            {read.projects[0]?.phases.map((entry) => (
              <th key={entry.phase} scope="col" className="px-1 text-center font-medium">
                {PHASE_LABEL[entry.phase]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {read.projects.map((row) => (
            <tr key={row.projectId}>
              <th scope="row" className="pe-3 text-start font-normal">
                <UserText>{row.name}</UserText>
              </th>
              {row.phases.map((entry) => (
                <td key={entry.phase} className="px-1 py-1 text-center">
                  <span
                    className={cn(
                      'inline-block rounded-full px-2 py-0.5 text-xs',
                      SHAPE_TONE[entry.shape],
                    )}
                  >
                    {row.configured ? SHAPE_WORD[entry.shape] : 'Not synced'}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {read.truncated ? (
        <p className="max-w-measure text-xs text-warning">
          Showing {String(read.projects.length)} of {String(read.total)} repositories.
        </p>
      ) : null}
    </div>
  );
}
