import React from 'react';
import { StatusDot } from '@lupin/ui';
import type { RunPhase } from '@lupin/shared-contracts';
import { isRunActive } from '../../hooks/useRuns.js';
import { type Run } from '../../lib/api.js';
import { formatDate as formatDateWithFallback } from '../../lib/format.js';
import { describeGateReason } from '../../lib/gate-reason.js';
import { statusWord } from '../../lib/status-word.js';
import { testAnchor } from '../CopilotExplain.js';

/** The quarantine form, prefilled with a failing test (plan Wave 1 task 1). */
export function quarantineHref(title: string, file: string): string {
  return `/dashboard/quarantine?${new URLSearchParams({ title, file }).toString()}`;
}

/**
 * Run detail: the phase timeline, the failures and the verdict. Moved out of
 * `routes/dashboard/run-detail.tsx`, which was 1,135 lines (ledger MNT-191).
 */

const PHASES: RunPhase[] = [
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
  'complete',
];

const ACTIVE_PHASES = new Set<RunPhase>([
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
]);

/**
 * Run detail says `Unknown` where the runs list says `Not started`: here the
 * field is unknown, not the run unstarted. The shared helper takes the fallback
 * as a parameter precisely so the two screens keep making different claims.
 */
export function formatDate(value: string | null | undefined): string {
  return formatDateWithFallback(value, 'Unknown');
}

export function PhaseTimeline({ phase }: { phase: RunPhase }) {
  const active = ACTIVE_PHASES.has(phase);
  const currentIndex = PHASES.indexOf(phase);

  return (
    <ol
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      aria-label="Run phase timeline"
    >
      {PHASES.map((item, index) => {
        const complete = currentIndex >= index && currentIndex >= 0;
        const current = item === phase;
        return (
          <li
            key={item}
            data-testid={`phase-${item}`}
            {...(current ? { 'aria-current': 'step' as const } : {})}
            className={`inline-flex items-center gap-1.5 ${
              current ? 'font-semibold text-accent' : complete ? 'text-fg' : 'text-fg-muted'
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${
                current ? 'bg-accent' : complete ? 'bg-success' : 'bg-border-strong'
              }`}
            />
            {item.replace('_', ' ')}
          </li>
        );
      })}
      {!active && !PHASES.includes(phase) ? (
        <li
          data-testid={`phase-${phase}`}
          aria-current="step"
          className="inline-flex items-center gap-1.5 font-semibold text-danger"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-danger" />
          {phase.replace('_', ' ')}
        </li>
      ) : null}
    </ol>
  );
}

export function TestEvidence({ tests }: { tests: Run['tests'] }) {
  if (tests.length === 0) {
    return (
      <p className="text-sm text-fg-muted max-w-measure text-pretty">
        No normalized test attempts have been reported.
      </p>
    );
  }
  const passed = tests.filter((test) => !isFailure(test.status));
  return (
    <div className="space-y-4">
      {groupFailures(tests).map((group) => (
        <section
          key={group.key}
          data-testid="failure-group"
          aria-label={`${String(group.tests.length)} ${group.tests.length === 1 ? 'test' : 'tests'}: ${group.message}`}
          className="space-y-2"
        >
          {/* Sentry-style: one head per cause, the count first, so the biggest cause is read first. */}
          <h3 data-testid="failure-group-head" className="flex items-baseline gap-3 text-sm">
            <span className="shrink-0 font-semibold text-danger">
              {group.tests.length} {group.tests.length === 1 ? 'test' : 'tests'}
            </span>
            <span className="min-w-0 truncate font-mono text-fg">{group.message}</span>
          </h3>
          <TestRows tests={group.tests} />
        </section>
      ))}
      {passed.length === 0 ? null : (
        <details data-testid="passed-tests" className="group" open={passed.length === tests.length}>
          <summary className="cursor-pointer select-none rounded-md py-1 text-sm text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
            {passed.length} passed
          </summary>
          <div className="mt-2">
            <TestRows tests={passed} />
          </div>
        </details>
      )}
    </div>
  );
}

/** A failed or timed-out test: what the failure groups are made of. */
export function isFailure(status: string): boolean {
  return status === 'failed' || status === 'timed_out';
}

/**
 * Failed tests grouped by what broke them, biggest group first.
 *
 * The key is the error message with what varies between occurrences of one cause taken out
 * (quoted data, hex ids, numbers), the same idea as `failureSignature` on the server, so two
 * timeouts on different ports are one group and a timeout and a declined card are two.
 */
function groupFailures(tests: Run['tests']): Array<{
  key: string;
  message: string;
  tests: Run['tests'];
}> {
  const groups = new Map<string, { key: string; message: string; tests: Run['tests'] }>();
  for (const test of tests.filter((entry) => isFailure(entry.status))) {
    const message = test.error?.message?.trim() || 'Failed with no message';
    const key = message
      .toLowerCase()
      .replace(/(['"`]).*?\1/gu, '""')
      .replace(/0x[0-9a-f]+|\b[0-9a-f]{8,}\b/gu, '#')
      .replace(/\d+/gu, 'n')
      .replace(/\s+/gu, ' ');
    const group = groups.get(key) ?? { key, message, tests: [] };
    group.tests = [...group.tests, test];
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.tests.length - a.tests.length);
}

function TestRows({ tests }: { tests: Run['tests'] }) {
  return (
    /*
     * The evidence surfaces sit one step *below* the panels, not on them.
     *
     * `--lupin-surface-sunken` is the plane step for content that is being
     * inspected rather than acted on: the test block and each timeline entry are
     * both things a reader is reading closely, and painting them on the same step as
     * the `Card` around them makes the page a field of identical rectangles with no
     * distinction between the chrome and the claim.
     *
     * `border-border-default` rather than `border-border-strong`, and the
     * distinction is not cosmetic: the strong border is the edge that is the only
     * thing delineating a *control*, which these are not.
     */
    <div className="space-y-3">
      {tests.map((test) => (
        <details
          key={test.id}
          id={testAnchor(test.id)}
          data-testid={`test-${test.id}`}
          className="rounded-md border border-border-default bg-surface-sunken p-4"
        >
          <summary className="cursor-pointer">
            <span className="inline-flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{test.title}</span>
              <span className="text-xs text-fg-muted">{statusWord(test.status)}</span>
            </span>
          </summary>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-fg-muted">File</dt>
              <dd>{test.file ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Duration</dt>
              <dd>{test.durationMs == null ? 'Unknown' : `${test.durationMs}ms`}</dd>
            </div>
          </dl>
          {test.error ? (
            <div
              data-testid={`test-error-${test.id}`}
              className="mt-3 rounded-md border border-danger p-3 text-sm"
            >
              <div className="font-semibold text-danger">{test.error.code}</div>
              <div>{test.error.message}</div>
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {/*
              `h3`, not `h4`, and the eyebrow idiom the rest of the product uses.
              *
              * It was an `<h4>`, which in a file whose screen heading is an `<h1>` and whose
              * section is an `<h2>` skipped a level — and it was the *first* heading in the
              * file, so the screen's heading list began at `h4` and the `h1` came third. The
              * `Composition` sweep found it, and it found it only because that sweep starts
              * from zero and checks the first heading rather than checking that each level
              * follows the one before it: an `h4` first satisfies "no level is skipped"
              * vacuously.
              */}
            <h3 className="text-sm font-medium text-fg">Attempts</h3>
            {test.attempts.length > 0 ? (
              test.attempts.map((attempt) => (
                <div key={attempt.attempt} className="rounded bg-surface-muted p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span>Attempt {attempt.attempt}</span>
                    <span>{statusWord(attempt.status)}</span>
                  </div>
                  <div className="mt-1 text-xs text-fg-muted">
                    {formatDate(attempt.startedAt)}{' '}
                    <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
                      →
                    </span>{' '}
                    {formatDate(attempt.finishedAt)}
                  </div>
                  {attempt.error ? (
                    <div className="mt-2 text-danger">{attempt.error.message}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-fg-muted max-w-measure text-pretty">
                No retry attempts were reported.
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** Gate reasons as `[sentence, raw]`, one per distinct sentence, in the server's order. */
function uniqueReasons(reasons: readonly string[]): Array<[string, string]> {
  const seen = new Map<string, string>();
  for (const raw of reasons) {
    const sentence = describeGateReason(raw);
    if (!seen.has(sentence)) seen.set(sentence, raw);
  }
  return [...seen.entries()];
}

/** Gate reasons as a dot-separated line of sentences, each with its raw code on hover. */
function GateSentences({ reasons }: { reasons: readonly string[] }): React.ReactElement {
  return (
    <>
      {uniqueReasons(reasons).map(([sentence, raw], index) => (
        <React.Fragment key={raw}>
          {index > 0 ? ' · ' : null}
          <span title={raw}>{sentence}</span>
        </React.Fragment>
      ))}
    </>
  );
}

/** How many failing tests the header names before pointing at the full list. */
const FAILURES_SHOWN = 5;

/** Reasons that name a cause on their own, most decisive first. */
const LEAD_REASONS = [
  'runner_lost:',
  'infra_failed:',
  'config_failed:',
  'cancelled:',
  'timed_out:',
  'evidence:NO_TESTS',
  'threshold:',
  'product_failure:TEST_FAILURE',
];

/** The sentence a failure is headed with when no test failed: the gate's own cause. */
function leadSentence(run: Run, reasons: readonly string[]): string {
  for (const prefix of LEAD_REASONS) {
    const found = reasons.find((reason) => reason.startsWith(prefix));
    if (found !== undefined) return describeGateReason(found);
  }
  if (run.error) return run.error.message;
  const [first] = reasons;
  return first === undefined ? 'The run failed' : describeGateReason(first);
}

/** A run nothing failed in: "all passed" only when every test did and the gate agrees. */
function RunPassed({
  run,
  gate,
}: {
  run: Run;
  gate: { status: string; reasons: readonly string[] } | null;
}): React.ReactElement | null {
  if (run.outcome !== 'passed') return null;
  const { passed, total } = run.summary;
  const cleared = gate === null || gate.status === 'passed';
  if (cleared && total > 0 && passed === total) {
    return (
      <p
        data-testid="run-verdict"
        className="inline-flex shrink-0 items-center gap-2 text-lg font-semibold text-success"
      >
        <StatusDot status="good" />
        {`All ${String(total)} tests passed`}
      </p>
    );
  }
  return (
    <div data-testid="run-verdict" className="shrink-0">
      <p className="inline-flex items-center gap-2 text-lg font-semibold text-fg">
        <StatusDot status={cleared ? 'warn' : 'unknown'} />
        {`${String(passed)} of ${String(total)} tests passed`}
      </p>
      {!cleared && gate !== null ? (
        <p className="mt-1 max-w-measure text-sm text-fg-muted">
          {`Quality gate ${gate.status}: `}
          <GateSentences reasons={gate.reasons} />
        </p>
      ) : null}
    </div>
  );
}

/**
 * The answer first: what failed, or that nothing did — and only "all passed" when that is
 * true of every test *and* the gate agrees.
 *
 * A failed run used to open on a phase timeline and four figures, and the reason it
 * failed was a panel and a click away. Now the cause heads the page: the failing tests and
 * their first error when tests failed, otherwise the gate's decisive reason (no tests ran,
 * a timeout, a missed threshold). A run whose tests passed but whose gate has no verdict, or
 * that skipped tests, says how many passed and why it is not green.
 */
export function RunVerdict({
  run,
  gate,
}: {
  run: Run;
  gate: { status: string; reasons: readonly string[] } | null;
}): React.ReactElement | null {
  if (isRunActive(run)) return null;
  const failing = run.tests.filter((test) => test.status === 'failed');
  const gateFailed = gate?.status === 'failed';
  const reasons = gate?.reasons ?? [];
  const failed =
    run.outcome === 'failed' || run.summary.failed > 0 || gateFailed || run.error != null;
  const { total } = run.summary;
  if (!failed) return <RunPassed run={run} gate={gate} />;
  return (
    <section
      aria-label="What failed"
      data-testid="run-what-failed"
      className="shrink-0 rounded-lg border border-border bg-surface px-5 py-4"
    >
      <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-danger">
        <StatusDot status="bad" />
        {run.summary.failed > 0
          ? `${String(run.summary.failed)} of ${String(total)} tests failed`
          : leadSentence(run, reasons)}
      </h2>
      {failing.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {failing.slice(0, FAILURES_SHOWN).map((test) => (
            <li key={test.id} className="min-w-0 py-2">
              <p className="text-sm font-medium text-fg">{test.title}</p>
              {test.error ? <p className="text-sm text-danger">{test.error.message}</p> : null}
              {test.file ? (
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <a
                    href={quarantineHref(test.title, test.file)}
                    className="rounded-sm text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    Quarantine this test
                  </a>
                </p>
              ) : null}
              {test.file ? (
                <p className="truncate font-mono text-xs text-fg-muted" title={test.file}>
                  {test.file}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {failing.length > FAILURES_SHOWN ? (
        <p className="mt-1 text-xs text-fg-muted">
          {`and ${String(failing.length - FAILURES_SHOWN)} more under Test attempts`}
        </p>
      ) : null}
      {gateFailed && reasons.length > 0 ? (
        <p className="mt-2 max-w-measure text-sm text-fg">
          <span className="text-fg-muted">Quality gate: </span>
          <GateSentences reasons={reasons} />
        </p>
      ) : null}
      {run.error ? (
        <p className="mt-2 text-sm text-fg">
          <span className="font-mono text-danger">{run.error.code}</span> {run.error.message}
        </p>
      ) : null}
    </section>
  );
}
