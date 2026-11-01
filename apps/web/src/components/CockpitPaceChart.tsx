import React from 'react';
import type { CockpitPaceWeek } from '@lupin/shared-contracts';
import {
  PACE_HEIGHT,
  PACE_LAYOUT,
  PACE_WIDTH,
  paceGeometry,
  type PaceGeometry,
} from '../lib/cockpit-view.js';

/**
 * Pace against quality: the question this product exists to answer.
 *
 * Development is fast because of AI, and the question is whether quality keeps up. So the
 * pull requests that merged each week are drawn as bars, with the part an agent wrote under
 * the rest, and the score that week as a line beneath them, on the same weeks. They share an
 * x axis and not a y axis on purpose: two scales on one plot invite a correlation the data
 * does not claim.
 *
 * Three things are kept honest:
 *
 * - **A gap is a gap.** A week with no reading breaks the line instead of leaning across it.
 * - **Two formulas are two lines.** Where the score was graded by a different formula the
 *   line stops and a dashed mark says why, because the step is the formula's, not the
 *   product's.
 * - **The current week is dimmer.** It is still in progress, so its bar is not yet a week's.
 *
 * It is loaded after the rest of the cockpit (`React.lazy` in `Cockpit.tsx`), and every
 * number in it is also in a table a screen reader reads, since a picture of a bar is no
 * number.
 */
export default function CockpitPaceChart({
  pace,
}: {
  pace: readonly CockpitPaceWeek[];
}): React.ReactElement {
  const geometry = React.useMemo<PaceGeometry>(() => paceGeometry(pace), [pace]);
  const { barsTop, barsHeight, lineTop, lineHeight, left, right } = PACE_LAYOUT;
  const first = pace[0];
  const last = pace.at(-1);
  return (
    <figure className="flex flex-col gap-2" data-testid="cockpit-pace">
      <svg
        viewBox={`0 0 ${String(PACE_WIDTH)} ${String(PACE_HEIGHT)}`}
        className="h-auto w-full"
        role="img"
        aria-label="Pull requests merged per week above the score for the same weeks. The table below has the numbers."
        focusable="false"
      >
        <line
          x1={left}
          x2={right}
          y1={barsTop + barsHeight}
          y2={barsTop + barsHeight}
          className="stroke-chart-grid"
        />
        <line
          x1={left}
          x2={right}
          y1={lineTop + lineHeight}
          y2={lineTop + lineHeight}
          className="stroke-chart-grid"
        />
        {geometry.bars.map((bar) => (
          <g key={bar.week} className={bar.partial ? 'opacity-60' : undefined}>
            {bar.otherHeight > 0 ? (
              <rect
                x={bar.x}
                y={bar.otherY}
                width={bar.width}
                height={bar.otherHeight}
                className="fill-chart-1"
              />
            ) : null}
            {bar.aiHeight > 0 ? (
              <rect
                x={bar.x}
                y={bar.aiY}
                width={bar.width}
                height={bar.aiHeight}
                className="fill-chart-2"
              />
            ) : null}
          </g>
        ))}
        {geometry.formulaBreaks.map((x) => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1={lineTop}
            y2={lineTop + lineHeight}
            strokeDasharray="3 3"
            className="stroke-warning"
          />
        ))}
        {geometry.scorePaths.map((path) => (
          <path
            key={path}
            d={path}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-chart-line"
          />
        ))}
        {geometry.scoreDots.map((dot) => (
          <circle key={dot.week} cx={dot.x} cy={dot.y} r={2.5} className="fill-chart-line" />
        ))}
        {first === undefined ? null : (
          <text x={left} y={PACE_HEIGHT - 6} fontSize={10} className="fill-fg-muted">
            {first.weekStart}
          </text>
        )}
        {last === undefined ? null : (
          <text
            x={right}
            y={PACE_HEIGHT - 6}
            fontSize={10}
            textAnchor="end"
            className="fill-fg-muted"
          >
            {last.weekStart} (this week)
          </text>
        )}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-chart-1" />
          Merged
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-chart-2" />
          Written by an agent
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-chart-line" />
          Score
        </span>
        {geometry.formulaBreaks.length > 0 ? (
          <span>Dashed: the scoring formula changed here, so the line is not joined.</span>
        ) : null}
      </figcaption>
      <table className="sr-only">
        <caption>Pull requests merged and score, by week</caption>
        <thead>
          <tr>
            <th scope="col">Week starting</th>
            <th scope="col">Merged</th>
            <th scope="col">Lines changed</th>
            <th scope="col">Written by an agent</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          {pace.map((week) => (
            <tr key={week.weekStart}>
              <th scope="row">{week.partial ? `${week.weekStart} (this week)` : week.weekStart}</th>
              <td>{week.merged}</td>
              <td>{week.linesChanged}</td>
              <td>{week.aiShare === null ? 'none merged' : `${String(week.aiShare)}%`}</td>
              <td>{week.score === null ? 'not measured' : week.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
