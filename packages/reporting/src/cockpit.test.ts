import { describe, expect, it } from 'vitest';
import { CockpitSchema } from '@lupin/shared-contracts';
import {
  buildCockpit,
  type CockpitChange,
  type CockpitHealthPoint,
  type CockpitInputs,
  type CockpitRun,
  type CockpitScanPoint,
} from './cockpit.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const sha = (character: string) => character.repeat(40);

const health = (
  days: number,
  score: number | null,
  extra: Partial<CockpitHealthPoint> = {},
): CockpitHealthPoint => ({
  at: ago(days),
  score,
  letter: null,
  formulaVersion: 1,
  commitSha: null,
  dimensions: {},
  ...extra,
});

const scan = (days: number, coverage: number | null, flakyTests: number): CockpitScanPoint => ({
  at: ago(days),
  coverage,
  flakyTests,
});

const run = (
  id: string,
  days: number,
  status: CockpitRun['status'],
  commit: string | null = null,
) => ({ id, startedAt: ago(days), status, commitSha: commit, prNumber: null }) satisfies CockpitRun;

function inputs(overrides: Partial<CockpitInputs> = {}): CockpitInputs {
  return {
    project: { id: 'project-1', name: 'Service' },
    branch: 'main',
    now: NOW,
    window: '7d',
    health: [],
    scans: [],
    runs: [],
    pullRequests: [],
    changes: [],
    riskPullRequests: [],
    deployments: [],
    productionEnvironments: ['production'],
    repository: { owner: 'octo', repo: 'service' },
    ...overrides,
  };
}

const metric = (cockpit: ReturnType<typeof buildCockpit>, id: string) => {
  const found = cockpit.metrics.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no metric ${id}`);
  return found;
};

describe('buildCockpit: the headline and the overall change', () => {
  it('says what moved, in the direction it moved, when the score fell', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80), health(1, 76)],
        scans: [scan(8, 70, 2), scan(1, 60, 5)],
      }),
    );
    expect(cockpit.overall).toMatchObject({
      score: 76,
      baseline: 80,
      delta: -4,
      status: 'worse',
    });
    expect(cockpit.headline).toBe(
      'Down 4 points since last week, mostly lower coverage and more flaky tests.',
    );
  });

  it('says so when the score rose, naming only what rose with it', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 70), health(1, 75)],
        scans: [scan(8, 50, 4), scan(1, 60, 1)],
      }),
    );
    expect(cockpit.overall.status).toBe('improved');
    expect(cockpit.headline).toBe(
      'Up 5 points since last week, mostly higher coverage and fewer flaky tests.',
    );
  });

  it('does not blame a metric that moved the other way', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80), health(1, 76)],
        // Coverage rose while the score fell: it cannot be what the score fell for.
        scans: [scan(8, 60, 2), scan(1, 70, 5)],
      }),
    );
    expect(cockpit.headline).toBe('Down 4 points since last week, mostly more flaky tests.');
  });

  it('reports a change under half a point as flat, not as movement', () => {
    const cockpit = buildCockpit(inputs({ health: [health(8, 80), health(1, 80.4)] }));
    expect(cockpit.overall).toMatchObject({ status: 'flat', delta: 0.4 });
    expect(cockpit.headline).toBe('No meaningful change since last week: the score is 80.4.');
  });

  it('says "not measured" when nothing was measured in the window, and shows no delta at all', () => {
    // The only reading is eight days old: nothing was measured in the last seven days.
    const cockpit = buildCockpit(inputs({ health: [health(8, 80)] }));
    expect(cockpit.overall).toMatchObject({
      score: null,
      delta: null,
      status: 'not_measured',
    });
    expect(cockpit.headline).toBe('Nothing was measured in the last 7 days.');
    for (const entry of cockpit.metrics) expect(entry.delta).toBeNull();
  });

  it('says there is nothing to compare with when the first reading is the only one', () => {
    const cockpit = buildCockpit(inputs({ health: [health(1, 82)] }));
    expect(cockpit.overall).toMatchObject({ score: 82, baseline: null, delta: null });
    expect(cockpit.overall.status).toBe('no_baseline');
    expect(cockpit.headline).toBe('The score is 82. There is no earlier reading to compare with.');
  });

  it('does not use a baseline older than the lookback', () => {
    const cockpit = buildCockpit(inputs({ health: [health(40, 90), health(1, 60)] }));
    expect(cockpit.overall.status).toBe('no_baseline');
    expect(cockpit.overall.delta).toBeNull();
  });

  it('skips a reading with no score instead of treating it as zero', () => {
    const cockpit = buildCockpit(
      inputs({ health: [health(8, 80), health(3, null), health(1, 78)] }),
    );
    expect(cockpit.overall).toMatchObject({ score: 78, baseline: 80, delta: -2 });
  });
});

describe('buildCockpit: never compares two formulas', () => {
  it('breaks the comparison where the formula changed, and says when', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80, { formulaVersion: 1 }), health(1, 60, { formulaVersion: 2 })],
      }),
    );
    expect(cockpit.overall).toMatchObject({ score: 60, delta: null, status: 'formula_changed' });
    expect(cockpit.formulaBreak).toEqual({ at: ago(1).toISOString(), from: 1, to: 2 });
    expect(cockpit.headline).toBe(
      'The scoring formula changed on 2026-10-25, so the score cannot be compared with earlier readings.',
    );
  });

  it('treats an unversioned reading (0) as not comparable with anything', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80, { formulaVersion: 0 }), health(1, 70, { formulaVersion: 1 })],
      }),
    );
    expect(cockpit.overall.status).toBe('formula_changed');
    expect(cockpit.overall.delta).toBeNull();
  });

  it('does not compare two unversioned readings either: the formula behind them is unknown', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80, { formulaVersion: 0 }), health(1, 70, { formulaVersion: 0 })],
      }),
    );
    expect(cockpit.overall.status).toBe('formula_changed');
  });

  it('applies the same rule to a dimension metric', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [
          health(8, 80, { formulaVersion: 1, dimensions: { security: 90 } }),
          health(1, 80, { formulaVersion: 2, dimensions: { security: 50 } }),
        ],
      }),
    );
    expect(metric(cockpit, 'security')).toMatchObject({ status: 'formula_changed', delta: null });
  });

  it('has no break when every reading used one formula', () => {
    expect(
      buildCockpit(inputs({ health: [health(8, 80), health(1, 78)] })).formulaBreak,
    ).toBeNull();
  });
});

describe('buildCockpit: drivers', () => {
  it('names the merged pull request whose commit the score moved on', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80), health(2, 74, { commitSha: sha('a') })],
        pullRequests: [
          {
            number: 42,
            title: 'Rewrite the cache',
            mergedAt: ago(2),
            mergeCommitSha: sha('a'),
            headSha: sha('b'),
          },
        ],
      }),
    );
    expect(cockpit.overall.drivers).toEqual([
      {
        kind: 'pull_request',
        ref: '42',
        label: 'PR #42: Rewrite the cache',
        url: 'https://github.com/octo/service/pull/42',
        candidate: false,
        change: -6,
        at: ago(2).toISOString(),
      },
    ]);
  });

  it('matches a pull request by its head commit too', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80), health(2, 74, { commitSha: sha('b') })],
        pullRequests: [
          { number: 7, title: 'Fix', mergedAt: null, mergeCommitSha: null, headSha: sha('b') },
        ],
      }),
    );
    expect(cockpit.overall.drivers[0]).toMatchObject({ kind: 'pull_request', ref: '7' });
  });

  it('falls back to a run on that commit, then to the commit itself', () => {
    const withRun = buildCockpit(
      inputs({
        health: [health(8, 80), health(2, 74, { commitSha: sha('c') })],
        runs: [run('run-9', 2, 'failed', sha('c'))],
      }),
    );
    expect(withRun.overall.drivers[0]).toMatchObject({
      kind: 'run',
      ref: 'run-9',
      url: null,
      candidate: false,
    });
    const bare = buildCockpit(
      inputs({ health: [health(8, 80), health(2, 74, { commitSha: sha('c') })] }),
    );
    expect(bare.overall.drivers[0]).toMatchObject({
      kind: 'commit',
      ref: sha('c'),
      url: `https://github.com/octo/service/commit/${sha('c')}`,
    });
  });

  it('says "unknown" when no commit was recorded, and does not guess one from the time', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80), health(2, 74, { commitSha: null })],
        // A pull request merged the same day would be a tempting guess. It is not named.
        pullRequests: [
          {
            number: 1,
            title: 'Nearby',
            mergedAt: ago(2),
            mergeCommitSha: sha('d'),
            headSha: sha('d'),
          },
        ],
      }),
    );
    expect(cockpit.overall.drivers).toHaveLength(1);
    expect(cockpit.overall.drivers[0]).toMatchObject({
      kind: 'unknown',
      ref: null,
      url: null,
      change: -6,
    });
  });

  it('picks the most recent run when several ran on one commit, whatever order they arrive in', () => {
    // Found by COCKPIT-3: the first run in the list was chosen, so the answer followed the order.
    const older = run('run-older', 3, 'failed', sha('c'));
    const newer = run('run-newer', 2, 'passed', sha('c'));
    for (const runs of [
      [older, newer],
      [newer, older],
    ]) {
      const cockpit = buildCockpit(
        inputs({
          health: [health(8, 80), health(2, 74, { commitSha: sha('c') })],
          runs,
        }),
      );
      expect(cockpit.overall.drivers[0]).toMatchObject({ kind: 'run', ref: 'run-newer' });
    }
  });

  it('has no links to GitHub when the project has no GitHub repository', () => {
    const cockpit = buildCockpit(
      inputs({
        repository: null,
        health: [health(8, 80), health(2, 74, { commitSha: sha('c') })],
      }),
    );
    expect(cockpit.overall.drivers[0]).toMatchObject({ kind: 'commit', url: null });
  });

  it('lists the largest steps first, at most three', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [
          health(8, 90),
          health(6, 89, { commitSha: sha('1') }),
          health(5, 80, { commitSha: sha('2') }),
          health(4, 79, { commitSha: sha('3') }),
          health(3, 70, { commitSha: sha('4') }),
          health(2, 69, { commitSha: sha('5') }),
        ],
      }),
    );
    expect(cockpit.overall.drivers.map((driver) => driver.ref)).toEqual([
      sha('2'),
      sha('4'),
      sha('1'),
    ]);
  });

  it('never makes a step across a formula change', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [
          health(8, 80, { formulaVersion: 1 }),
          health(2, 40, { formulaVersion: 2, commitSha: sha('e') }),
        ],
      }),
    );
    expect(cockpit.overall.drivers).toEqual([]);
  });

  it('offers the runs that happened while a scan metric moved as candidates, not as the cause', () => {
    const cockpit = buildCockpit(
      inputs({
        scans: [scan(8, 70, 0), scan(3, 70, 0), scan(1, 55, 0)],
        runs: [
          run('before', 5, 'passed', sha('f')),
          run('during-1', 2, 'passed', sha('1')),
          run('during-2', 1.5, 'failed', sha('2')),
        ],
      }),
    );
    const coverage = metric(cockpit, 'coverage');
    expect(coverage.status).toBe('worse');
    expect(coverage.drivers.map((driver) => [driver.ref, driver.candidate, driver.kind])).toEqual([
      ['during-2', true, 'run'],
      ['during-1', true, 'run'],
    ]);
    expect(coverage.drivers[0]?.change).toBe(-15);
  });

  it('says "unknown" when no run was recorded while a scan metric moved', () => {
    const cockpit = buildCockpit(inputs({ scans: [scan(8, 70, 0), scan(1, 55, 0)] }));
    expect(metric(cockpit, 'coverage').drivers).toMatchObject([
      { kind: 'unknown', candidate: false, change: -15 },
    ]);
  });
});

describe('buildCockpit: the scan and run metrics', () => {
  it('treats more flaky tests as worse, because fewer is the better number', () => {
    const cockpit = buildCockpit(inputs({ scans: [scan(8, 70, 2), scan(1, 70, 5)] }));
    expect(metric(cockpit, 'flaky-tests')).toMatchObject({
      value: 5,
      baseline: 2,
      delta: 3,
      status: 'worse',
      higherIsBetter: false,
    });
  });

  it('skips a scan with no coverage rather than reading it as zero', () => {
    const cockpit = buildCockpit(inputs({ scans: [scan(8, 70, 0), scan(1, null, 0)] }));
    expect(metric(cockpit, 'coverage').status).toBe('not_measured');
  });

  it('computes the run pass rate over finished runs only', () => {
    const cockpit = buildCockpit(
      inputs({
        runs: [
          run('p1', 12, 'passed'),
          run('p2', 11, 'passed'),
          run('p3', 10, 'failed'),
          run('c1', 4, 'passed'),
          run('c2', 3, 'failed'),
          run('c3', 2, 'failed'),
          run('c4', 1, 'failed'),
          run('still-running', 0.5, 'running'),
        ],
      }),
    );
    expect(metric(cockpit, 'run-pass-rate')).toMatchObject({
      value: 25,
      baseline: 66.7,
      delta: -41.7,
      status: 'worse',
    });
    expect(metric(cockpit, 'run-pass-rate').drivers.map((driver) => driver.ref)).toEqual([
      'c4',
      'c3',
      'c2',
    ]);
  });

  it('will not call a rate over fewer than three finished runs a change', () => {
    const cockpit = buildCockpit(
      inputs({
        runs: [run('p1', 12, 'passed'), run('p2', 11, 'passed'), run('c1', 2, 'failed')],
      }),
    );
    expect(metric(cockpit, 'run-pass-rate').status).toBe('not_measured');
  });

  it('has every metric once, in a fixed order', () => {
    expect(buildCockpit(inputs()).metrics.map((entry) => entry.id)).toEqual([
      'security',
      'tests',
      'code-quality',
      'dependencies',
      'coverage',
      'flaky-tests',
      'run-pass-rate',
    ]);
  });

  it('keeps at most thirty points of a series, newest last', () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      scan(60 - index - 0.1, 50 + (index % 5), 0),
    );
    const series = metric(buildCockpit(inputs({ scans: many })), 'coverage').series;
    expect(series).toHaveLength(30);
    expect(series.at(-1)?.at).toBe(many.at(-1)?.at.toISOString());
  });
});

describe('buildCockpit: since the last release', () => {
  const deployments = [
    { createdAt: ago(20), environment: 'production', status: 'success' as const },
    { createdAt: ago(5), environment: 'production', status: 'success' as const },
    { createdAt: ago(2), environment: 'production', status: 'failure' as const },
    { createdAt: ago(1), environment: 'staging', status: 'success' as const },
  ];

  it('compares with the reading before the last successful production deployment', () => {
    const cockpit = buildCockpit(
      inputs({
        window: 'release',
        deployments,
        health: [health(6, 85), health(3, 78)],
      }),
    );
    expect(cockpit.since).toBe(ago(5).toISOString());
    expect(cockpit.overall).toMatchObject({ baseline: 85, score: 78, delta: -7, status: 'worse' });
    expect(cockpit.headline).toBe('Down 7 points since the last release.');
  });

  it('says nothing has shipped when there is no production deployment to compare with', () => {
    const cockpit = buildCockpit(
      inputs({
        window: 'release',
        deployments: [{ createdAt: ago(1), environment: 'staging', status: 'success' }],
        health: [health(3, 78)],
      }),
    );
    expect(cockpit.since).toBeNull();
    expect(cockpit.overall.status).toBe('no_baseline');
    expect(cockpit.headline).toBe(
      'Nothing has shipped to production yet, so there is no release to compare with.',
    );
  });

  it('matches the production environment name without regard to case', () => {
    const cockpit = buildCockpit(
      inputs({
        window: 'release',
        productionEnvironments: ['Production'],
        deployments: [{ createdAt: ago(5), environment: 'production', status: 'success' }],
        health: [health(6, 85), health(3, 78)],
      }),
    );
    expect(cockpit.since).toBe(ago(5).toISOString());
  });
});

describe('buildCockpit: pace against quality', () => {
  // NOW is Monday 2026-10-26 12:00 UTC, so the current week started that morning.
  const change = (mergedAt: string | null, extra: Partial<CockpitChange> = {}): CockpitChange => ({
    mergedAt: mergedAt === null ? null : new Date(mergedAt),
    additions: 10,
    deletions: 5,
    attribution: 'human',
    ...extra,
  });
  const weekOf = (cockpit: ReturnType<typeof buildCockpit>, weekStart: string) => {
    const found = cockpit.pace.find((week) => week.weekStart === weekStart);
    if (found === undefined) throw new Error(`no week ${weekStart}`);
    return found;
  };

  it('has the last twelve Monday weeks, oldest first, the current one marked partial', () => {
    const { pace } = buildCockpit(inputs());
    expect(pace).toHaveLength(12);
    expect(pace[0]?.weekStart).toBe('2026-08-10');
    expect(pace[11]?.weekStart).toBe('2026-10-26');
    expect(pace.map((week) => week.partial)).toEqual([...Array<boolean>(11).fill(false), true]);
    for (const week of pace) expect(new Date(`${week.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('fills a week in which nothing merged with zeros and no share, never a gap or a 0%', () => {
    const quiet = weekOf(buildCockpit(inputs()), '2026-09-14');
    expect(quiet).toMatchObject({
      merged: 0,
      linesChanged: 0,
      aiAuthored: 0,
      unattributed: 0,
      aiShare: null,
      score: null,
      formulaVersion: null,
    });
  });

  it('counts the pull requests merged in a week and the lines they changed', () => {
    const cockpit = buildCockpit(
      inputs({
        changes: [
          change('2026-10-20T09:00:00Z', { additions: 100, deletions: 20 }),
          change('2026-10-22T09:00:00Z', { additions: 1, deletions: 2 }),
          change('2026-10-13T09:00:00Z', { additions: 7, deletions: 0 }),
        ],
      }),
    );
    expect(weekOf(cockpit, '2026-10-19')).toMatchObject({ merged: 2, linesChanged: 123 });
    expect(weekOf(cockpit, '2026-10-12')).toMatchObject({ merged: 1, linesChanged: 7 });
  });

  it('shares AI-written change by count, and does not call an unattributed change human or AI', () => {
    const cockpit = buildCockpit(
      inputs({
        changes: [
          change('2026-10-20T09:00:00Z', { attribution: 'agent-authored' }),
          change('2026-10-20T10:00:00Z', { attribution: 'ai-assisted' }),
          change('2026-10-20T11:00:00Z', { attribution: 'human' }),
          change('2026-10-20T12:00:00Z', { attribution: 'unknown' }),
        ],
      }),
    );
    expect(weekOf(cockpit, '2026-10-19')).toMatchObject({
      merged: 4,
      aiAuthored: 2,
      unattributed: 1,
      aiShare: 50,
    });
  });

  it('rounds a share to one decimal', () => {
    const cockpit = buildCockpit(
      inputs({
        changes: [
          change('2026-10-20T09:00:00Z', { attribution: 'agent-authored' }),
          change('2026-10-20T10:00:00Z', { attribution: 'human' }),
          change('2026-10-20T11:00:00Z', { attribution: 'human' }),
        ],
      }),
    );
    expect(weekOf(cockpit, '2026-10-19').aiShare).toBe(33.3);
  });

  it('puts a change at the exact boundary in the later week, in UTC', () => {
    const cockpit = buildCockpit(
      inputs({
        changes: [
          change('2026-10-18T23:59:59.999Z'),
          change('2026-10-19T00:00:00.000Z'),
          change('2026-10-25T23:59:59.999Z'),
        ],
      }),
    );
    expect(weekOf(cockpit, '2026-10-12').merged).toBe(1);
    expect(weekOf(cockpit, '2026-10-19').merged).toBe(2);
  });

  it('ignores a change that is unmerged, in the future, or older than the twelve weeks', () => {
    const cockpit = buildCockpit(
      inputs({
        changes: [
          change(null),
          change('2026-10-27T00:00:00Z'),
          change('2026-08-09T23:59:59Z'),
          change('2026-08-10T00:00:00Z'),
        ],
      }),
    );
    expect(cockpit.pace.reduce((sum, week) => sum + week.merged, 0)).toBe(1);
    expect(weekOf(cockpit, '2026-08-10').merged).toBe(1);
  });

  it('puts the last score of the week, and the formula that graded it, beside the pace', () => {
    const cockpit = buildCockpit(
      inputs({
        health: [
          health(8, 80, { formulaVersion: 1 }),
          health(7, 78, { formulaVersion: 1 }),
          health(1, 70, { formulaVersion: 2 }),
        ],
      }),
    );
    // health(8) is 2026-10-18 (Sunday), health(7) 2026-10-19 (Monday), health(1) 2026-10-25.
    expect(weekOf(cockpit, '2026-10-12')).toMatchObject({ score: 80, formulaVersion: 1 });
    expect(weekOf(cockpit, '2026-10-19')).toMatchObject({ score: 70, formulaVersion: 2 });
    expect(weekOf(cockpit, '2026-10-26')).toMatchObject({ score: null, formulaVersion: null });
  });

  it('skips a reading with no score instead of showing the week as 0', () => {
    const cockpit = buildCockpit(inputs({ health: [health(3, null)] }));
    expect(weekOf(cockpit, '2026-10-19').score).toBeNull();
  });

  it('is not changed by the window asked for: pace is always the last twelve weeks', () => {
    const changes = [change('2026-10-20T09:00:00Z')];
    expect(buildCockpit(inputs({ changes, window: 'release' })).pace).toEqual(
      buildCockpit(inputs({ changes, window: '7d' })).pace,
    );
  });
});
describe('buildCockpit: edge cases a payload must survive', () => {
  it('shortens a very long pull request title in the driver label, not the reference', () => {
    const title = 'x'.repeat(300);
    const cockpit = buildCockpit(
      inputs({
        health: [health(8, 80), health(2, 74, { commitSha: sha('a') })],
        pullRequests: [
          { number: 5, title, mergedAt: ago(2), mergeCommitSha: sha('a'), headSha: null },
        ],
      }),
    );
    const driver = cockpit.overall.drivers[0];
    expect(driver?.label).toHaveLength(120);
    expect(driver?.label.endsWith('\u2026')).toBe(true);
    expect(driver?.ref).toBe('5');
  });

  it('names the lowest pull request number when two carry the commit, in either order', () => {
    const pullRequests = [
      { number: 9, title: 'Later', mergedAt: ago(2), mergeCommitSha: sha('a'), headSha: null },
      { number: 3, title: 'Earlier', mergedAt: ago(2), mergeCommitSha: null, headSha: sha('a') },
    ];
    for (const ordered of [pullRequests, [...pullRequests].reverse()]) {
      const cockpit = buildCockpit(
        inputs({
          health: [health(8, 80), health(2, 74, { commitSha: sha('a') })],
          pullRequests: ordered,
        }),
      );
      expect(cockpit.overall.drivers[0]?.ref).toBe('3');
    }
  });

  it('breaks a tie between two runs started at the same instant by their id, in either order', () => {
    const left = { ...run('run-b', 3, 'failed', sha('c')), startedAt: ago(3) };
    const right = { ...run('run-a', 3, 'passed', sha('c')), startedAt: ago(3) };
    for (const runs of [
      [left, right],
      [right, left],
    ]) {
      const cockpit = buildCockpit(
        inputs({ health: [health(8, 80), health(2, 74, { commitSha: sha('c') })], runs }),
      );
      expect(cockpit.overall.drivers[0]?.ref).toBe('run-a');
    }
  });

  it('shows no score in the pace for a reading older than twelve weeks or from the future', () => {
    const cockpit = buildCockpit(inputs({ health: [health(200, 50), health(-1, 99)] }));
    expect(cockpit.pace.every((week) => week.score === null)).toBe(true);
  });

  it('does not count a production deployment that has not happened yet as the last release', () => {
    const cockpit = buildCockpit(
      inputs({
        window: 'release',
        deployments: [
          { createdAt: ago(5), environment: 'production', status: 'success' },
          { createdAt: ago(-1), environment: 'production', status: 'success' },
        ],
        health: [health(6, 85), health(3, 78)],
      }),
    );
    expect(cockpit.since).toBe(ago(5).toISOString());
  });
});
describe('buildCockpit: risks', () => {
  it('reads the risk block from the risk pull requests of the shown branch', () => {
    const risky = {
      number: 9,
      title: 'Big',
      state: 'merged',
      draft: false,
      baseBranch: 'main',
      openedAt: ago(3),
      mergedAt: ago(2),
      additions: 900,
      deletions: 0,
      testsTouched: false,
      humanApprovalCount: 1,
      attribution: 'human',
    };
    const cockpit = buildCockpit(
      inputs({ riskPullRequests: [risky], repository: { owner: 'o', repo: 'r' } }),
    );
    expect(cockpit.risks.total).toBe(1);
    expect(cockpit.risks.items[0]).toMatchObject({
      kind: 'large_change_without_tests',
      url: 'https://github.com/o/r/pull/9',
    });
    expect(buildCockpit(inputs()).risks).toEqual({ total: 0, items: [] });
  });
});

describe('buildCockpit: the contract', () => {
  it('always produces a payload that parses against CockpitSchema', () => {
    const full = buildCockpit(
      inputs({
        health: [
          health(8, 80, { dimensions: { security: 90, tests: 70 } }),
          health(2, 74, { commitSha: sha('a'), dimensions: { security: 80, tests: 70 } }),
        ],
        scans: [scan(8, 70, 2), scan(1, 60, 5)],
        runs: [run('r1', 1, 'failed', sha('a'))],
      }),
    );
    expect(() => CockpitSchema.parse(JSON.parse(JSON.stringify(full)))).not.toThrow();
    expect(() =>
      CockpitSchema.parse(JSON.parse(JSON.stringify(buildCockpit(inputs())))),
    ).not.toThrow();
  });
});
