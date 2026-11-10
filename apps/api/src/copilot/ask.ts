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

export function answerQuestion(question: string, runs: readonly ExecutionRun[]): QuestionAnswer {
  const words = question.toLowerCase();
  const newest = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const none: QuestionAnswer = { source: 'rules', answer: CAN_ANSWER, citations: [], links: [] };
  const intent = FLAKY.test(words)
    ? 'flaky'
    : SHIP.test(words)
      ? 'ship'
      : FAILING.test(words)
        ? 'failing'
        : null;
  if (intent === null) return none;
  if (newest.length === 0) {
    return {
      ...none,
      answer: 'There are no runs in this workspace yet, so there is nothing to answer from.',
    };
  }

  if (intent === 'flaky') {
    const seen = new Map<string, string>();
    for (const run of newest) {
      for (const test of run.tests) {
        if (test.status === 'flaky' && !seen.has(test.id)) seen.set(test.id, run.id);
      }
    }
    const count = seen.size;
    return {
      source: 'rules',
      answer:
        count === 0
          ? `No test was flaky in the last ${String(newest.length)} runs.`
          : `${String(count)} ${count === 1 ? 'test was' : 'tests were'} flaky in the last ${String(newest.length)} runs.`,
      citations: [...seen].map(([id, runId]) => ({ kind: 'test' as const, id, runId })),
      links: [{ label: 'See flaky tests', to: '/dashboard/insights' }],
    };
  }

  if (intent === 'ship') {
    const main = newest.find((run) => run.branch === 'main' || run.branch === 'master');
    if (main === undefined) {
      return {
        ...none,
        answer: 'No run on main has been reported, so there is no release signal yet.',
      };
    }
    return {
      source: 'rules',
      answer: `The newest run on ${main.branch ?? 'main'} ${main.outcome === 'passed' ? 'passed' : main.outcome === 'failed' ? 'failed' : 'has not finished'}. ${explainRun(main).summary}`,
      citations: [{ kind: 'run', id: main.id }],
      links: [
        { label: 'Open the run', to: runPath(main.id) },
        { label: 'Release readiness', to: '/dashboard' },
      ],
    };
  }

  const red = newest.find((run) => run.outcome === 'failed');
  if (red === undefined) {
    return {
      ...none,
      answer: `Nothing is failing: none of the last ${String(newest.length)} runs failed.`,
    };
  }
  const explained = explainRun(red);
  return {
    source: 'rules',
    answer: explained.summary,
    citations: explained.citations,
    links: [{ label: 'Open the run', to: runPath(red.id) }],
  };
}
