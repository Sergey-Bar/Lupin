/**
 * The copilot's answer to a typed question, from the workspace's recent runs alone.
 *
 * The same rules as `explain.ts`: every number is counted from the runs it read, every run
 * and test it talks about is cited, and a question it has no evidence for is answered with
 * what it can answer rather than a guess. It recognises three questions, by their words:
 * what is failing, which tests are flaky, and whether the newest run on main passed.
 */
import type { ExecutionRun } from '../execution/types.js';
import { explainRun, type Citation } from './explain.js';

export interface QuestionAnswer {
  source: 'rules';
  answer: string;
  citations: Citation[];
  links: Array<{ label: string; to: string }>;
}

const FLAKY = /\b(flak\w*|unstable|flipp\w*|quarantin\w*)\b/u;
const SHIP = /\b(ship|release|ready|readiness|deploy|go|green)\b/u;
const FAILING = /\b(fail\w*|broke\w*|red|why|error\w*|wrong)\b/u;

const CAN_ANSWER =
  'I can answer what is failing, which tests are flaky, and whether the newest run on main passed. Ask one of those.';

function runPath(id: string): string {
  return `/dashboard/runs/${encodeURIComponent(id)}`;
}

type Intent = 'flaky' | 'ship' | 'failing';

function intentOf(words: string): Intent | null {
  if (FLAKY.test(words)) return 'flaky';
  if (SHIP.test(words)) return 'ship';
  if (FAILING.test(words)) return 'failing';
  return null;
}

function rules(answer: string, extra: Partial<QuestionAnswer> = {}): QuestionAnswer {
  return { source: 'rules', answer, citations: [], links: [], ...extra };
}

function flakyAnswer(newest: readonly ExecutionRun[]): QuestionAnswer {
  const seen = new Map<string, string>();
  for (const run of newest) {
    for (const test of run.tests.filter((entry) => entry.status === 'flaky')) {
      if (!seen.has(test.id)) seen.set(test.id, run.id);
    }
  }
  const runs = String(newest.length);
  const subject = seen.size === 1 ? 'test was' : 'tests were';
  return rules(
    seen.size === 0
      ? `No test was flaky in the last ${runs} runs.`
      : `${String(seen.size)} ${subject} flaky in the last ${runs} runs.`,
    {
      citations: [...seen].map(([id, runId]) => ({ kind: 'test' as const, id, runId })),
      links: [{ label: 'See flaky tests', to: '/dashboard/insights' }],
    },
  );
}

const VERDICT: Record<string, string> = { passed: 'passed', failed: 'failed' };

function shipAnswer(newest: readonly ExecutionRun[]): QuestionAnswer {
  const main = newest.find((run) => run.branch === 'main' || run.branch === 'master');
  if (main === undefined) {
    return rules('No run on main has been reported, so there is no release signal yet.');
  }
  const verdict = VERDICT[main.outcome ?? ''] ?? 'has not finished';
  return rules(
    `The newest run on ${main.branch ?? 'main'} ${verdict}. ${explainRun(main).summary}`,
    {
      citations: [{ kind: 'run', id: main.id }],
      links: [
        { label: 'Open the run', to: runPath(main.id) },
        { label: 'Release readiness', to: '/dashboard' },
      ],
    },
  );
}

function failingAnswer(newest: readonly ExecutionRun[]): QuestionAnswer {
  const red = newest.find((run) => run.outcome === 'failed');
  if (red === undefined) {
    return rules(`Nothing is failing: none of the last ${String(newest.length)} runs failed.`);
  }
  const explained = explainRun(red);
  return rules(explained.summary, {
    citations: explained.citations,
    links: [{ label: 'Open the run', to: runPath(red.id) }],
  });
}

const ANSWERS: Record<Intent, (newest: readonly ExecutionRun[]) => QuestionAnswer> = {
  flaky: flakyAnswer,
  ship: shipAnswer,
  failing: failingAnswer,
};

export function answerQuestion(question: string, runs: readonly ExecutionRun[]): QuestionAnswer {
  const intent = intentOf(question.toLowerCase());
  if (intent === null) return rules(CAN_ANSWER);
  if (runs.length === 0) {
    return rules('There are no runs in this workspace yet, so there is nothing to answer from.');
  }
  const newest = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ANSWERS[intent](newest);
}
