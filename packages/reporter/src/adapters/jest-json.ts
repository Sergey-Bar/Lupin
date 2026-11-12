import type { ProducerAdapter } from '../adapter.js';
import { list, record, type Json } from './json-fields.js';
import {
  durationOf,
  parseJsonDocument,
  relativePath,
  statusOf,
  testResultsRun,
  textOf,
  type AttemptInput,
  type TestInput,
} from './test-results-json.js';

/**
 * `jest --json` output, and the Jest-compatible shape Vitest's `json` reporter writes:
 * `{ "testResults": [{ "name": <file>, "assertionResults": [...] }] }`.
 *
 * Each assertion result is one test: `ancestorTitles` is the describe path, `title` the
 * title, `failureMessages` the error (ANSI colour removed). Jest records no retry history in
 * this document, so a Jest test has one attempt. Vitest may write `retryCount`, the number of
 * attempts before the last; those attempts failed, because a passing attempt is not retried.
 * A file that failed to run at all (`testExecError`, or a `message` with no assertions) is a
 * report error, since no test result describes it.
 */

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

type Producer = 'jest' | 'vitest';

function testOf(producer: Producer, file: string, entry: Json): TestInput | null {
  const title = textOf(entry['title']);
  if (title === '') return null;
  const rawStatus = textOf(entry['status']);
  const message = list(entry['failureMessages'])
    .map(textOf)
    .filter((line) => line !== '')
    .join('\n')
    .replace(ANSI, '');
  const final: AttemptInput = {
    rawStatus,
    status: statusOf(producer, rawStatus),
    durationMs: durationOf(entry['duration']),
    message,
  };
  const retries = producer === 'vitest' ? Math.floor(durationOf(entry['retryCount']) ?? 0) : 0;
  const earlier: AttemptInput[] = Array.from({ length: Math.min(retries, 100) }, () => ({
    rawStatus: 'failed',
    status: 'failed' as const,
  }));
  return {
    file,
    describePath: list(entry['ancestorTitles'])
      .map(textOf)
      .filter((segment) => segment !== ''),
    title,
    attempts: [...earlier, final],
  };
}

/** One suite's tests, and the failure that stopped it from running any, when there was one. */
function suiteOf(
  producer: Producer,
  suite: Record<string, unknown>,
): { tests: TestInput[]; error: string | null } {
  const file = relativePath(textOf(suite['name']));
  const assertions = list(suite['assertionResults']);
  const tests: TestInput[] = [];
  for (const assertion of assertions) {
    const entry = record(assertion);
    const test = entry === null ? null : testOf(producer, file, entry);
    if (test !== null) tests.push(test);
  }
  const execError = textOf(record(suite['testExecError'])?.['message']);
  const failure = execError || (assertions.length === 0 ? textOf(suite['message']) : '');
  return { tests, error: failure === '' ? null : `${file}: ${failure.replace(ANSI, '')}` };
}

export function jestShapedAdapter(
  producer: Producer,
  label: string,
  mediaType: string,
): ProducerAdapter {
  return {
    mediaType,
    parse(input, context) {
      const document = record(parseJsonDocument(input, label));
      if (document === null || !Array.isArray(document['testResults'])) {
        throw new Error(`${label} has no testResults array`);
      }
      const tests: TestInput[] = [];
      const reportErrors: { message: string }[] = [];
      for (const item of list(document['testResults'])) {
        const suite = record(item);
        if (suite === null) continue;
        const read = suiteOf(producer, suite);
        tests.push(...read.tests);
        if (read.error !== null) reportErrors.push({ message: read.error });
      }
      return testResultsRun(
        tests,
        producer,
        `packages/reporter ${producer}-json`,
        context,
        reportErrors,
      );
    },
  };
}

export const jestJsonAdapter: ProducerAdapter = jestShapedAdapter(
  'jest',
  'Jest JSON report',
  'application/vnd.jest.results+json',
);
