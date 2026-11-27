import React from 'react';
import { Skeleton, StatusDot, type DotStatus } from '@lupin/ui';
import type { PulseDirection, QualityPulse } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';

const DOT: Record<PulseDirection, DotStatus> = {
  better: 'good',
  worse: 'bad',
  steady: 'info',
  unknown: 'unknown',
};

/** The pulse on Home, or nothing when the page was given no pulse to read. */
export function HomePulse({
  source,
  projectId,
}: {
  source: React.ComponentProps<typeof PulseLine>['load'] | undefined;
  projectId: string | undefined;
}): React.ReactElement | null {
  return source === undefined ? null : <PulseLine load={source} projectId={projectId} />;
}

/**
 * The quality pulse on Home (plan 1795712849115 task 15): did this project's quality get better
 * or worse since the window before, and the one sign that decided it.
 *
 * The release verdict above says whether to ship now; this says which way things are going.
 * A "worse" lists what also improved, so it never reads as the whole story, and missing
 * evidence is said as unknown, never as steady. `load` resolving `null` means there is no
 * project to read yet, and the line draws nothing.
 */
export function PulseLine({
  load,
  projectId,
}: {
  load: (projectId: string | undefined) => Promise<QualityPulse | null>;
  projectId: string | undefined;
}): React.ReactElement | null {
  const pulse = useResource(() => load(projectId), [load, projectId]);
  if (pulse.status === 'loading')
    return <Skeleton data-testid="pulse-loading" className="h-16 w-full" />;
  if (pulse.status === 'error') {
    return (
      <p data-testid="pulse-unread" role="status" className="text-sm text-fg-muted">
        Lupin could not read whether quality got better or worse ({pulse.message}).
      </p>
    );
  }
  const value = pulse.value;
  if (value === null) return null;
  return (
    <section
      aria-label="Quality pulse"
      data-testid="pulse-line"
      data-direction={value.direction}
      className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        <StatusDot status={DOT[value.direction]} />
        <span>{value.sentence}</span>
      </p>
      <p className="text-sm text-fg-muted">
        Last {value.windowDays} days against the {value.windowDays} before · {value.confidence}{' '}
        confidence
      </p>
      {value.alsoMoved.length === 0 ? null : (
        <p data-testid="pulse-also" className="text-sm text-fg-muted">
          Also moved: {value.alsoMoved.map((move) => move.text).join('; ')}
        </p>
      )}
    </section>
  );
}
