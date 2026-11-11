import React from 'react';
import { cn } from '@lupin/ui';
import type { ShapeReading } from '@lupin/shared-contracts';
import type { Resource } from '../hooks/useResource.js';
import { formatRelative } from '../lib/intl.js';
import { UserText } from './Bidi.js';
import { SHAPE_TONE, SHAPE_WORD } from './Phases.js';

/**
 * Where you are, and whether it is in good shape: the portfolio, then a repository, then a pull
 * request, each with its verdict, so zooming in or out never loses the answer.
 *
 * Every level shows its shape in a word as well as a colour. The level you are on says why, and
 * how fresh its evidence is: stale evidence is said, never drawn as good.
 */
export interface ZoomLevel {
  label: string;
  /** Where the level opens; `null` for the level you are on. */
  href: string | null;
  reading: Resource<ShapeReading>;
}

function freshnessText(reading: ShapeReading, now: Date): string {
  if (reading.freshness === 'never' || reading.measuredAt === null) return 'Never measured';
  const when = formatRelative(reading.measuredAt, now);
  return reading.freshness === 'stale' ? `Stale: last measured ${when}` : `Measured ${when}`;
}

function Chip({ reading }: { reading: Resource<ShapeReading> }): React.ReactElement {
  if (reading.status !== 'ready') {
    return (
      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-fg-muted">
        {reading.status === 'loading' ? 'Reading…' : 'Unreadable'}
      </span>
    );
  }
  const stale = reading.value.freshness === 'stale';
  return (
    <span
      title={reading.value.reason}
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        SHAPE_TONE[reading.value.shape],
      )}
    >
      {SHAPE_WORD[reading.value.shape]}
      {stale ? <span className="font-normal"> · stale</span> : null}
    </span>
  );
}

export function ZoomBar({
  levels,
  now = () => new Date(),
}: {
  levels: readonly ZoomLevel[];
  now?: () => Date;
}): React.ReactElement {
  const here = levels.at(-1);
  return (
    <div data-testid="zoom-bar" className="flex flex-col gap-1">
      <nav aria-label="Zoom">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {levels.map((level, index) => (
            <li key={`${level.label}-${String(index)}`} className="flex items-center gap-2">
              {index === 0 ? null : (
                <span aria-hidden="true" className="text-fg-muted">
                  /
                </span>
              )}
              {level.href === null ? (
                <span aria-current="page" className="font-medium text-fg">
                  <UserText>{level.label}</UserText>
                </span>
              ) : (
                <a
                  href={level.href}
                  className="text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  <UserText>{level.label}</UserText>
                </a>
              )}
              <Chip reading={level.reading} />
            </li>
          ))}
        </ol>
      </nav>
      {here?.reading.status === 'ready' ? (
        <p data-testid="zoom-reason" className="max-w-measure text-xs text-fg-muted">
          <UserText>{here.reading.value.reason}</UserText>{' '}
          <span>{freshnessText(here.reading.value, now())}.</span>
        </p>
      ) : here?.reading.status === 'error' ? (
        <p role="alert" className="max-w-measure text-xs text-danger">
          The shape could not be read: {here.reading.message}
        </p>
      ) : null}
    </div>
  );
}
