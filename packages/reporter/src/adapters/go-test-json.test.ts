import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { goTestJsonAdapter } from './go-test-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://go',
  sourceDigest: 'c'.repeat(64),
  producerVersion: 'go1.25.4',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};
const PKG = 'example.com/shop/cart';
const T = '2026-11-26T10:00:01.000000Z';
const lines = (...events: object[]) =>
  new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join('\n'));

/** What `go test -json ./...` prints, event by event. */
const RUN = lines(
  { Time: T, Action: 'start', Package: PKG },
  { Time: T, Action: 'run', Package: PKG, Test: 'TestAdd' },
  { Time: T, Action: 'output', Package: PKG, Test: 'TestAdd', Output: '=== RUN   TestAdd\n' },
  { Time: T, Action: 'pass', Package: PKG, Test: 'TestAdd', Elapsed: 0.01 },
  { Time: T, Action: 'run', Package: PKG, Test: 'TestCoupon' },
  { Time: T, Action: 'run', Package: PKG, Test: 'TestCoupon/expired' },
  {
    Time: T,
    Action: 'output',
    Package: PKG,
    Test: 'TestCoupon/expired',
    Output: '    cart_test.go:31: want 90, got 100\n',
  },
  { Time: T, Action: 'fail', Package: PKG, Test: 'TestCoupon/expired', Elapsed: 0.02 },
  { Time: T, Action: 'fail', Package: PKG, Test: 'TestCoupon', Elapsed: 0.03 },
  { Time: T, Action: 'run', Package: PKG, Test: 'TestBank' },
  {
    Time: T,
    Action: 'output',
    Package: PKG,
    Test: 'TestBank',
    Output: '    cart_test.go:40: no sandbox\n',
  },
  { Time: T, Action: 'skip', Package: PKG, Test: 'TestBank', Elapsed: 0 },
  { Time: T, Action: 'output', Package: PKG, Output: 'FAIL\n' },
  { Time: T, Action: 'fail', Package: PKG, Elapsed: 0.2 },
);

describe('the go test -json adapter', () => {
  const result = goTestJsonAdapter.parse(RUN, context);
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it('reads each test and subtest, a subtest under its parent', () => {
    expect(byTitle.get('TestAdd')).toMatchObject({
      status: 'passed',
      durationMs: 10,
      specPath: PKG,
    });
    expect(byTitle.get('expired')).toMatchObject({
      status: 'failed',
      describePath: ['TestCoupon'],
    });
    expect(byTitle.get('TestBank')?.status).toBe('skipped');
  });

  it("keeps a failed test's log as its message", () => {
    expect(byTitle.get('expired')?.error?.message).toContain('want 90, got 100');
    expect(byTitle.get('TestAdd')?.error).toBeUndefined();
  });

  it('fails a test that started and never ended, with the package output as the reason', () => {
    const crashed = lines(
      { Action: 'run', Package: PKG, Test: 'TestHangs' },
      { Action: 'output', Package: PKG, Output: 'panic: test timed out after 10m0s\n' },
      { Action: 'fail', Package: PKG, Elapsed: 600 },
    );
    const attempt = goTestJsonAdapter.parse(crashed, context).attempts[0];
    expect(attempt?.status).toBe('failed');
    expect(attempt?.error?.message).toContain('panic: test timed out');
  });

  it('reports a package that failed to build, and reads -count runs as attempts', () => {
    const mixed = lines(
      { Action: 'output', Package: 'example.com/broken', Output: './x.go:3: undefined: y\n' },
      { Action: 'fail', Package: 'example.com/broken', Elapsed: 0 },
      { Action: 'run', Package: PKG, Test: 'TestFlaky' },
      { Action: 'fail', Package: PKG, Test: 'TestFlaky', Elapsed: 0.1 },
      { Action: 'run', Package: PKG, Test: 'TestFlaky' },
      { Action: 'pass', Package: PKG, Test: 'TestFlaky', Elapsed: 0.1 },
      'not json at all' as unknown as object,
    );
    const parsed = goTestJsonAdapter.parse(mixed, context);
    expect(JSON.stringify(parsed)).toContain('undefined: y');
    const flaky = parsed.attempts.filter((attempt) => attempt.title === 'TestFlaky');
    expect(flaky.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);
    expect(flaky[0]?.flakiness).toBe('observed');
  });

  it('refuses a document with no events', () => {
    expect(() =>
      goTestJsonAdapter.parse(new TextEncoder().encode('ok  example.com/x\n'), context),
    ).toThrow(/no JSON events/u);
  });
});
