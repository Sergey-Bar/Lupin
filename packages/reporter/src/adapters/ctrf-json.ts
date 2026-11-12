import type { ProducerAdapter } from '../adapter.js';
import { list, record, type Json } from './json-fields.js';
import {
  durationOf,
  parseJsonDocument,
  relativePath,
  statusOf,
  testResultsRun,
  textOf,
  type AttachmentReference,
  type AttemptInput,
  type TestInput,
} from './test-results-json.js';

/**
 * CTRF (Common Test Report Format, ctrf.io) JSON: `{ "results": { "tool", "summary", "tests" } }`.
 *
 * A test's `retryAttempts[]` are its earlier attempts and the test itself is the last; when a
 * producer writes only the `retries` count, the earlier attempts are failures by definition
 * (a passing attempt is not retried), so that many failed attempts precede the final one.
 * `flaky: true` is honoured as the producer's own observation. `steps[]` become steps and
 * `attachments[]` become references to the paths CTRF names; the bytes are not in the file.
 */

const LABEL = 'CTRF report';

function attachmentsOf(value: unknown): AttachmentReference[] {
  return list(value).flatMap((item) => {
    const attachment = record(item);
    const path = textOf(attachment?.['path']);
    if (path === '') return [];
    const contentType = textOf(attachment?.['contentType']);
    return [
      {
        name: textOf(attachment?.['name']) || path,
        path,
        ...(contentType === '' ? {} : { contentType }),
      },
    ];
  });
}

function attemptOf(entry: Json, withSteps: boolean): AttemptInput {
  const rawStatus = textOf(entry['status']);
  const start = entry['start'];
  return {
    rawStatus,
    status: statusOf('ctrf', rawStatus),
    durationMs: durationOf(entry['duration']),
    ...(typeof start === 'number' && Number.isFinite(start) && start > 0
      ? { startedAt: new Date(start).toISOString() }
      : {}),
    message: textOf(entry['message']) || textOf(entry['trace']),
    attachments: attachmentsOf(entry['attachments']),
    steps: withSteps
      ? list(entry['steps']).flatMap((item) => {
          const step = record(item);
          const name = textOf(step?.['name']);
          return step === null || name === '' ? [] : [{ name, rawStatus: textOf(step['status']) }];
        })
      : [],
  };
}

function suiteOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textOf).filter((segment) => segment !== '');
  const suite = textOf(value);
  return suite === '' ? [] : suite.split(' > ').map((segment) => segment.trim());
}

function testOf(entry: Json): TestInput | null {
  const title = textOf(entry['name']);
  if (title === '') return null;
  const earlier = list(entry['retryAttempts'])
    .map(record)
    .filter((attempt): attempt is Json => attempt !== null)
    .map((attempt) => attemptOf(attempt, false));
  const retries = durationOf(entry['retries']) ?? 0;
  const counted: AttemptInput[] =
    earlier.length === 0
      ? Array.from({ length: Math.min(Math.floor(retries), 100) }, () => ({
          rawStatus: 'failed',
          status: 'failed' as const,
        }))
      : earlier;
  return {
    file: relativePath(textOf(entry['filePath'])),
    describePath: suiteOf(entry['suite']),
    title,
    project: textOf(entry['browser']) || textOf(entry['device']),
    attempts: [...counted, attemptOf(entry, true)],
    flaky: entry['flaky'] === true,
  };
}

export const ctrfJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.ctrf+json',
  parse(input, context) {
    const results = record(record(parseJsonDocument(input, LABEL))?.['results']);
    if (results === null || !Array.isArray(results['tests'])) {
      throw new Error(`${LABEL} has no results.tests array`);
    }
    const tests = list(results['tests'])
      .map(record)
      .flatMap((entry) => (entry === null ? [] : [testOf(entry)]))
      .filter((test): test is TestInput => test !== null);
    return testResultsRun(tests, 'ctrf', 'packages/reporter ctrf-json', context);
  },
};
