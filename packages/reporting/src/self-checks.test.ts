import { describe, expect, it } from 'vitest';
import { selfChecks } from './self-checks.js';

const now = new Date('2026-11-26T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe('selfChecks', () => {
  it('says nothing about facts it was not given, so a fresh install is quiet', () => {
    expect(selfChecks({ now })).toEqual([]);
  });

  it('says a runner is offline only while work waits for it', () => {
    const offline = selfChecks({ now, lastHeartbeatAt: ago(4 * MIN + 30 * MIN), queuedJobs: 2 });
    expect(offline).toEqual([
      expect.objectContaining({
        id: 'self-runner-offline',
        severity: 'bad',
        title: 'Runner offline for 34 min',
        detail: '2 queued jobs are waiting',
        fix: { label: 'Open runners', to: '/dashboard/runner' },
      }),
    ]);
    expect(selfChecks({ now, lastHeartbeatAt: ago(30 * MIN), queuedJobs: 0 })).toEqual([]);
    expect(selfChecks({ now, lastHeartbeatAt: ago(MIN), queuedJobs: 3 })).toEqual([]);
    expect(selfChecks({ now, lastHeartbeatAt: null, queuedJobs: 1 })[0]?.title).toBe(
      'No runner has connected',
    );
  });

  it('notices results going silent, but not an install that never had any', () => {
    expect(selfChecks({ now, lastResultAt: ago(3 * DAY) })[0]?.title).toBe(
      'No test results for 3 days',
    );
    expect(selfChecks({ now, lastResultAt: ago(DAY) })).toEqual([]);
    expect(selfChecks({ now, lastResultAt: null })).toEqual([]);
  });

  it('names a connector failing repeatedly, and not one that failed once among many', () => {
    const items = selfChecks({
      now,
      connectors: { slack: { calls: 4, failures: 3 }, jira: { calls: 40, failures: 3 } },
    });
    expect(items.map((item) => item.id)).toEqual(['self-connector-slack']);
    expect(items[0]?.detail).toBe('3 of its last 4 calls failed');
  });

  it('asks for a backup that is old or missing, when the caller can see backups', () => {
    expect(selfChecks({ now, lastBackupAt: ago(9 * DAY) })[0]?.title).toBe(
      'Last backup 9 days ago',
    );
    expect(selfChecks({ now, lastBackupAt: null })[0]?.title).toBe('No backup yet');
    expect(selfChecks({ now, lastBackupAt: ago(2 * DAY) })).toEqual([]);
  });

  it('notices runs that no gate judges', () => {
    expect(selfChecks({ now, recentRuns: { total: 5, gated: 0 } })[0]?.id).toBe('self-ungated');
    expect(selfChecks({ now, recentRuns: { total: 5, gated: 1 } })).toEqual([]);
    expect(selfChecks({ now, recentRuns: { total: 2, gated: 0 } })).toEqual([]);
  });

  it('puts the worst first', () => {
    const items = selfChecks({
      now,
      lastResultAt: ago(3 * DAY),
      lastHeartbeatAt: ago(60 * MIN),
      queuedJobs: 1,
    });
    expect(items.map((item) => item.severity)).toEqual(['bad', 'caution']);
  });
});
