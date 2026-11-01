import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CockpitSchema, type Cockpit } from '@lupin/shared-contracts';
import {
  buildCockpit,
  type CockpitChange,
  type CockpitHealthPoint,
  type CockpitInputs,
  type CockpitRun,
  type CockpitScanPoint,
} from './cockpit.js';

/**
 * Property suite for COCKPIT-1 to COCKPIT-4. Fixed seed and `numRuns`, so a red run
 * reproduces on any host.
 *
 * - COCKPIT-1: a change is stated only between two comparable readings; "nothing measured" is
 *   never a zero.
 * - COCKPIT-2: a driver names only a pull request, run or commit that is in the input, and a
 *   metric that did not move has none.
 * - COCKPIT-3: the order the readings arrive in does not change the answer.
 * - COCKPIT-4: the pace series is twelve contiguous Monday weeks that lose and invent no change.
 */
const SEED = 20261106;
const params = { seed: SEED, numRuns: 300 } as const;

const NOW = new Date('2026-10-26T12:00:00.000Z');
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

/** Six commits. A reading, a pull request and a run each use a commit at most once. */
const SHAS = ['a', 'b', 'c', 'd', 'e', 'f'].map((character) => character.repeat(40));

const healthPoints = fc
  .uniqueArray(fc.integer({ min: 0, max: 24 * 40 }), { maxLength: 12 })
  .chain((hours) =>
    fc.tuple(
      ...hours.map((hour, index) =>
        fc.record({
          at: fc.constant(hoursAgo(hour)),
          score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
          letter: fc.constant(null),
          formulaVersion: fc.constantFrom(0, 1, 1, 1, 2),
          // Distinct commits where there is one, so a driver's origin is unambiguous.
          commitSha: fc.option(fc.constant(SHAS[index % SHAS.length] as string), { nil: null }),
          dimensions: fc.record(
            {
              security: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
              tests: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
            },
            { requiredKeys: [] },
          ),
        }),
      ),
    ),
  ) as fc.Arbitrary<CockpitHealthPoint[]>;

const scanPoints = fc
  .uniqueArray(fc.integer({ min: 0, max: 24 * 40 }), { maxLength: 12 })
  .chain((hours) =>
    fc.tuple(
      ...hours.map((hour) =>
        fc.record({
          at: fc.constant(hoursAgo(hour)),
          coverage: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
          flakyTests: fc.integer({ min: 0, max: 20 }),
        }),
      ),
    ),
  ) as fc.Arbitrary<CockpitScanPoint[]>;

const runList = fc
  .uniqueArray(fc.integer({ min: 0, max: 24 * 40 }), { maxLength: 14 })
  .chain((hours) =>
    fc.tuple(
      ...hours.map((hour, index) =>
        fc.record({
          id: fc.constant(`run-${String(index)}`),
          startedAt: fc.constant(hoursAgo(hour)),
          commitSha: fc.option(fc.constant(SHAS[index % SHAS.length] as string), { nil: null }),
          status: fc.constantFrom('passed', 'failed', 'running', 'interrupted'),
          prNumber: fc.constant(null),
        }),
      ),
    ),
  ) as fc.Arbitrary<CockpitRun[]>;

const pullRequestList = fc
  .uniqueArray(fc.integer({ min: 0, max: SHAS.length - 1 }), {
    maxLength: SHAS.length,
  })
  .map((indexes) =>
    indexes.map((index) => ({
      number: index + 1,
      title: `Change ${String(index + 1)}`,
      mergedAt: hoursAgo(index),
      mergeCommitSha: SHAS[index] as string,
      headSha: null,
    })),
  );

const changeList = fc.array(
  fc.record({
    mergedAt: fc.option(fc.integer({ min: -24, max: 24 * 110 }).map(hoursAgo), { nil: null }),
    additions: fc.integer({ min: 0, max: 5000 }),
    deletions: fc.integer({ min: 0, max: 5000 }),
    attribution: fc.constantFrom(
      'agent-authored' as const,
      'ai-assisted' as const,
      'human' as const,
      'unknown' as const,
    ),
  }),
  { maxLength: 40 },
) as fc.Arbitrary<CockpitChange[]>;

const input = fc.record({
  window: fc.constantFrom('7d' as const, 'release' as const),
  health: healthPoints,
  scans: scanPoints,
  runs: runList,
  pullRequests: pullRequestList,
  changes: changeList,
  deployments: fc.array(
    fc.record({
      createdAt: fc.integer({ min: 0, max: 24 * 40 }).map(hoursAgo),
      environment: fc.constantFrom('production', 'staging'),
      status: fc.constantFrom('success' as const, 'failure' as const),
    }),
    { maxLength: 5 },
  ),
  withRepository: fc.boolean(),
});

type Generated = typeof input extends fc.Arbitrary<infer T> ? T : never;

function toInputs(raw: Generated): CockpitInputs {
  return {
    project: { id: 'project-1', name: 'Service' },
    branch: 'main',
    now: NOW,
    window: raw.window,
    health: raw.health,
    scans: raw.scans,
    runs: raw.runs,
    pullRequests: raw.pullRequests,
    changes: raw.changes,
    riskPullRequests: [],
    deployments: raw.deployments,
    productionEnvironments: ['production'],
    repository: raw.withRepository ? { owner: 'octo', repo: 'service' } : null,
  };
}

const allStates = (cockpit: Cockpit) => [
  {
    status: cockpit.overall.status,
    value: cockpit.overall.score,
    baseline: cockpit.overall.baseline,
    delta: cockpit.overall.delta,
    drivers: cockpit.overall.drivers,
  },
  ...cockpit.metrics.map((metric) => ({
    status: metric.status,
    value: metric.value,
    baseline: metric.baseline,
    delta: metric.delta,
    drivers: metric.drivers,
  })),
];

/** COCKPIT-1 as a predicate over one metric's state: true when the claim holds. */
function statesOnlyWhatItKnows(state: ReturnType<typeof allStates>[number]): boolean {
  const compared =
    state.status === 'improved' || state.status === 'worse' || state.status === 'flat';
  if (compared) return state.value !== null && state.baseline !== null && state.delta !== null;
  if (state.status === 'not_measured') {
    return state.value === null && state.baseline === null && state.delta === null;
  }
  // no_baseline and formula_changed: there is no delta, and in particular no delta of 0.
  return state.delta === null;
}

describe('COCKPIT-1: a change is stated only between two comparable readings', () => {
  it('holds for every metric and the overall score, whatever was measured', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const cockpit = buildCockpit(toInputs(raw));
        return allStates(cockpit).every(statesOnlyWhatItKnows);
      }),
      params,
    );
  });

  it('holds for a payload that parses against the contract', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const cockpit = buildCockpit(toInputs(raw));
        return CockpitSchema.safeParse(JSON.parse(JSON.stringify(cockpit))).success;
      }),
      params,
    );
  });

  it('never compares readings of different formulas: the overall delta is null then', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const cockpit = buildCockpit(toInputs(raw));
        if (cockpit.overall.status !== 'improved' && cockpit.overall.status !== 'worse')
          return true;
        // A real comparison means the two readings behind it shared a real formula version.
        const scored = raw.health
          .filter((point) => point.score !== null && point.at.getTime() <= NOW.getTime())
          .sort((left, right) => left.at.getTime() - right.at.getTime());
        const current = scored.at(-1);
        return current !== undefined && current.formulaVersion >= 1;
      }),
      params,
    );
  });

  it('pins the case a zero would be tempting: nothing measured at all', () => {
    const cockpit = buildCockpit(
      toInputs({
        window: '7d',
        health: [],
        scans: [],
        runs: [],
        pullRequests: [],
        changes: [],
        deployments: [],
        withRepository: false,
      }),
    );
    expect(allStates(cockpit).every((state) => state.delta === null)).toBe(true);
  });
});

describe('COCKPIT-2: a driver names only what is in the input', () => {
  it('holds: every named pull request, run and commit exists, and at most three are shown', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const cockpit = buildCockpit(toInputs(raw));
        const pullRequests = new Set(raw.pullRequests.map((pr) => String(pr.number)));
        const runs = new Set(raw.runs.map((run) => run.id));
        const commits = new Set(
          raw.health.flatMap((point) => (point.commitSha === null ? [] : [point.commitSha])),
        );
        return allStates(cockpit).every(
          (state) =>
            state.drivers.length <= 3 &&
            state.drivers.every((driver) => {
              if (driver.kind === 'unknown') return driver.ref === null && !driver.candidate;
              if (driver.ref === null) return false;
              if (driver.kind === 'pull_request') return pullRequests.has(driver.ref);
              if (driver.kind === 'run') return runs.has(driver.ref);
              return commits.has(driver.ref);
            }),
        );
      }),
      params,
    );
  });

  it('holds: a metric that did not improve or worsen has no driver', () => {
    fc.assert(
      fc.property(input, (raw) =>
        allStates(buildCockpit(toInputs(raw))).every(
          (state) =>
            state.status === 'improved' || state.status === 'worse' || state.drivers.length === 0,
        ),
      ),
      params,
    );
  });

  it('holds: a link points at github.com, and only for a project that has a repository', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const cockpit = buildCockpit(toInputs(raw));
        return allStates(cockpit).every((state) =>
          state.drivers.every(
            (driver) =>
              driver.url === null ||
              (raw.withRepository && driver.url.startsWith('https://github.com/octo/service/')),
          ),
        );
      }),
      params,
    );
  });
});

describe('COCKPIT-3: the order readings arrive in does not change the answer', () => {
  it('holds when every input list is reversed', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const forward = buildCockpit(toInputs(raw));
        const reversed = buildCockpit(
          toInputs({
            ...raw,
            health: [...raw.health].reverse(),
            scans: [...raw.scans].reverse(),
            runs: [...raw.runs].reverse(),
            pullRequests: [...raw.pullRequests].reverse(),
            changes: [...raw.changes].reverse(),
            deployments: [...raw.deployments].reverse(),
          }),
        );
        return JSON.stringify(forward) === JSON.stringify(reversed);
      }),
      params,
    );
  });
});

const WEEK = 7 * 24 * HOUR;

/** COCKPIT-4 as a predicate: true when the pace series holds. */
function paceHolds(cockpit: Cockpit, changes: readonly CockpitChange[]): boolean {
  const { pace } = cockpit;
  if (pace.length !== 12) return false;
  // Twelve contiguous Mondays, seven days apart, the last the current week and the only partial.
  const starts = pace.map((week) => Date.parse(`${week.weekStart}T00:00:00Z`));
  if (!starts.every((start) => new Date(start).getUTCDay() === 1)) return false;
  if (
    !starts.every((start, index) => index === 0 || start - (starts[index - 1] as number) === WEEK)
  ) {
    return false;
  }
  if (
    pace.map((week) => week.partial).join() !== [...Array<boolean>(11).fill(false), true].join()
  ) {
    return false;
  }
  const first = starts[0] as number;
  const inWindow = changes.filter(
    (change) =>
      change.mergedAt !== null &&
      change.mergedAt.getTime() >= first &&
      change.mergedAt.getTime() <= NOW.getTime(),
  );
  const sum = (pick: (week: (typeof pace)[number]) => number) =>
    pace.reduce((total, week) => total + pick(week), 0);
  if (sum((week) => week.merged) !== inWindow.length) return false;
  if (
    sum((week) => week.linesChanged) !== inWindow.reduce((s, c) => s + c.additions + c.deletions, 0)
  ) {
    return false;
  }
  return pace.every(
    (week) =>
      week.aiAuthored + week.unattributed <= week.merged &&
      (week.merged === 0
        ? week.aiShare === null
        : week.aiShare !== null && week.aiShare >= 0 && week.aiShare <= 100) &&
      (week.score === null) === (week.formulaVersion === null),
  );
}

describe('COCKPIT-4: the pace series loses and invents no change', () => {
  it('holds: twelve contiguous Monday weeks whose counts add up to what merged in them', () => {
    fc.assert(
      fc.property(input, (raw) => paceHolds(buildCockpit(toInputs(raw)), raw.changes)),
      params,
    );
  });

  it('holds whichever window is asked for', () => {
    fc.assert(
      fc.property(input, (raw) => {
        const seven = buildCockpit(toInputs({ ...raw, window: '7d' }));
        const release = buildCockpit(toInputs({ ...raw, window: 'release' }));
        return JSON.stringify(seven.pace) === JSON.stringify(release.pace);
      }),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('the COCKPIT-1 checker refutes a delta of zero over nothing measured', () => {
    expect(
      statesOnlyWhatItKnows({
        status: 'not_measured',
        value: null,
        baseline: null,
        delta: 0,
        drivers: [],
      }),
    ).toBe(false);
    expect(
      statesOnlyWhatItKnows({
        status: 'formula_changed',
        value: 60,
        baseline: 80,
        delta: -20,
        drivers: [],
      }),
    ).toBe(false);
  });

  it('the COCKPIT-4 checker refutes a pace that dropped a change', () => {
    const honest = buildCockpit(
      toInputs({
        window: '7d',
        health: [],
        scans: [],
        runs: [],
        pullRequests: [],
        changes: [{ mergedAt: hoursAgo(5), additions: 3, deletions: 1, attribution: 'human' }],
        deployments: [],
        withRepository: false,
      }),
    );
    const changes: CockpitChange[] = [
      { mergedAt: hoursAgo(5), additions: 3, deletions: 1, attribution: 'human' },
    ];
    expect(paceHolds(honest, changes)).toBe(true);
    // The same payload, claimed to hold a change it never counted.
    expect(
      paceHolds(honest, [
        ...changes,
        { mergedAt: hoursAgo(6), additions: 1, deletions: 1, attribution: 'human' },
      ]),
    ).toBe(false);
  });

  it('finds a counterexample to "no week ever has a share"', () => {
    const outcome = fc.check(
      fc.property(input, (raw) =>
        buildCockpit(toInputs(raw)).pace.every((week) => week.aiShare === null),
      ),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
  it('finds a counterexample to a false claim about the generator', () => {
    // "Every payload has a delta" is false the moment a window holds nothing.
    const outcome = fc.check(
      fc.property(input, (raw) => buildCockpit(toInputs(raw)).overall.delta !== null),
      params,
    );
    expect(outcome.failed).toBe(true);
  });

  it('finds a counterexample to "readings of any formula compare"', () => {
    const outcome = fc.check(
      fc.property(input, (raw) => buildCockpit(toInputs(raw)).overall.status !== 'formula_changed'),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
