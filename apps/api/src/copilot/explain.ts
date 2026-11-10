/**
 * The copilot's rule engine: an explanation of one run, built only from that run's evidence.
 *
 * It is what the copilot says when no model is configured, and the grounding a model's answer
 * is checked against when one is. Three rules hold it honest:
 *
 *  1. **Every number is counted from the run.** The summary's "3 of 4 tests" is the length of
 *     the run's own test list, never a figure the engine computed some other way.
 *  2. **Every claim cites its evidence.** The run and each test it talks about are listed as
 *     citations; a test it did not read is never cited.
 *  3. **No evidence, no claim.** A failed run with no tests and no error says so, and proposes
 *     nothing, rather than guessing a cause.
 *
 * Error text is uploaded data: it is redacted for credentials before it is quoted, and capped,
 * because the answer can travel to a hosted model and back to a reader.
 */
import type { ExecutionRun, ExecutionTestResult } from '../execution/types.js';

export interface Citation {
  kind: 'run' | 'test';
  id: string;
  runId?: string;
}

export type ProposedAction =
  | { kind: 'retry'; runId: string; scope: 'failed' | 'all'; label: string }
  | {
      kind: 'quarantine';
      testId: string;
      testTitle: string;
      testFile: string;
      runId: string;
      label: string;
    };

export interface Cause {
  message: string;
  count: number;
  tests: string[];
}

export interface RunExplanation {
  source: 'rules';
  summary: string;
  causes: Cause[];
  citations: Citation[];
  actions: ProposedAction[];
}

/** Longest error message quoted, after redaction. */
const MESSAGE_CAP = 300;

/**
 * Credentials that turn up in test output: GitHub and similar prefixed tokens, bearer
 * headers, AWS access keys, and `key=value` secrets. Replaced, not truncated.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abpr]|lup)_[A-Za-z0-9_]{16,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/giu,
];

export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out.length > MESSAGE_CAP ? `${out.slice(0, MESSAGE_CAP - 1)}…` : out;
}

const FAILED: ReadonlySet<ExecutionTestResult['status']> = new Set(['failed', 'timed_out']);

/** One cause per message, with what varies between occurrences of a cause taken out. */
function signature(message: string): string {
  return message
    .toLowerCase()
    .replace(/(['"`]).*?\1/gu, '""')
    .replace(/0x[0-9a-f]+|\b[0-9a-f]{8,}\b/gu, '#')
    .replace(/\d+/gu, 'n')
    .replace(/\s+/gu, ' ')
    .trim();
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

export function explainRun(run: ExecutionRun): RunExplanation {
  const tests = run.tests ?? [];
  const failed = tests.filter((test) => FAILED.has(test.status));
  const flaky = tests.filter((test) => test.status === 'flaky');
  const where = run.branch ? ` on ${run.branch}` : '';

  const groups = new Map<string, Cause>();
  for (const test of failed) {
    const message = redact(test.error?.message?.trim() || 'Failed with no message');
    const key = signature(message);
    const cause = groups.get(key) ?? { message, count: 0, tests: [] };
    cause.count += 1;
    cause.tests.push(test.id);
    groups.set(key, cause);
  }
  const causes = [...groups.values()].sort((a, b) => b.count - a.count);

  const citations: Citation[] = [{ kind: 'run', id: run.id }];
  for (const test of [...failed, ...flaky])
    citations.push({ kind: 'test', id: test.id, runId: run.id });

  const actions: ProposedAction[] = [];
  if (failed.length > 0) {
    actions.push({
      kind: 'retry',
      runId: run.id,
      scope: 'failed',
      label: `Retry the ${plural(failed.length, 'failed test')}`,
    });
  }
  // Quarantine is offered only for a test that both failed and passed: a test that only
  // fails is broken, and quarantining it would hide the truth it is telling.
  for (const test of flaky) {
    actions.push({
      kind: 'quarantine',
      testId: test.id,
      testTitle: test.title,
      testFile: test.file ?? '',
      runId: run.id,
      label: `Quarantine ${test.title}`,
    });
  }

  let summary: string;
  if (run.outcome === 'passed') {
    summary = `All ${String(tests.length)} tests passed${where}.`;
  } else if (tests.length === 0) {
    summary = run.error?.message
      ? `The run failed before it reported any tests: "${redact(run.error.message)}".`
      : 'The run failed before it reported any tests, and it left no error to explain why.';
  } else if (causes.length === 0) {
    summary = `The run ended ${run.outcome ?? 'without a verdict'}${where}, and no test reported a failure.`;
  } else {
    const [first] = causes as [Cause, ...Cause[]];
    summary =
      `${String(failed.length)} of ${String(tests.length)} tests failed${where}, from ${plural(causes.length, 'cause')}. ` +
      `The biggest, in ${plural(first.count, 'test')}: "${first.message}".`;
  }
  return { source: 'rules', summary, causes, citations, actions };
}
