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
  type TestInput,
} from './test-results-json.js';

/**
 * Mochawesome JSON, the report Cypress projects write (`cypress-mochawesome-reporter`, or
 * `mochawesome` with `mochawesome-merge`): `{ "stats", "results": [{ "file", "suites": [...] }] }`.
 *
 * Suites nest; their titles are the describe path and the result's `file` (relative, unlike
 * `fullFile`) is the spec. A test's `state` is its outcome, except that a skipped test has
 * `skipped: true` and no state. Mochawesome keeps no retry history, so each test is one
 * attempt. `context` entries naming a file (`addContext` with a screenshot or video path)
 * become attachment references; the bytes are not in the report.
 */

const LABEL = 'Mochawesome report';
const FILE_LIKE = /\.[a-z0-9]{2,5}$/iu;

function parsedContext(value: unknown): unknown[] {
  if (typeof value !== 'string') return Array.isArray(value) ? value : [value];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [value];
  }
}

function attachmentsOf(value: unknown): AttachmentReference[] {
  return parsedContext(value).flatMap((item) => {
    const entry = record(item);
    const path = typeof item === 'string' ? item.trim() : textOf(entry?.['value']);
    if (path === '' || !FILE_LIKE.test(path)) return [];
    return [{ name: textOf(entry?.['title']) || path, path }];
  });
}

function testOf(entry: Json, file: string, describePath: string[]): TestInput | null {
  const title = textOf(entry['title']);
  if (title === '') return null;
  const rawStatus = entry['skipped'] === true ? 'skipped' : textOf(entry['state']);
  const error = record(entry['err']);
  return {
    file,
    describePath,
    title,
    attempts: [
      {
        rawStatus,
        status: statusOf('cypress', rawStatus),
        durationMs: durationOf(entry['duration']),
        message: textOf(error?.['message']),
        attachments: attachmentsOf(entry['context']),
      },
    ],
  };
}

function testsOfSuite(suite: Json, file: string, describePath: string[]): TestInput[] {
  const ownFile = textOf(suite['file']) === '' ? file : relativePath(textOf(suite['file']));
  const title = textOf(suite['title']);
  const path = title === '' ? describePath : [...describePath, title];
  return [
    ...list(suite['tests']).flatMap((item) => {
      const entry = record(item);
      const test = entry === null ? null : testOf(entry, ownFile, path);
      return test === null ? [] : [test];
    }),
    ...list(suite['suites']).flatMap((item) => {
      const child = record(item);
      return child === null ? [] : testsOfSuite(child, ownFile, path);
    }),
  ];
}

export const mochawesomeJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.mochawesome+json',
  parse(input, context) {
    const document = record(parseJsonDocument(input, LABEL));
    if (document === null || !Array.isArray(document['results'])) {
      throw new Error(`${LABEL} has no results array`);
    }
    const tests = list(document['results']).flatMap((item) => {
      const result = record(item);
      return result === null ? [] : testsOfSuite(result, relativePath(textOf(result['file'])), []);
    });
    return testResultsRun(tests, 'cypress', 'packages/reporter mochawesome-json', context);
  },
};
