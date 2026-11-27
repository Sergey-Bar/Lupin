import type { ProducerAdapter } from '../adapter.js';
import { list, record, type Json } from './json-fields.js';
import {
  durationOf,
  parseJsonDocument,
  relativePath,
  statusOf,
  testResultsRun,
  textOf,
  type StepInput,
  type TestInput,
} from './test-results-json.js';

/**
 * Newman's JSON reporter (`newman run collection.json -r json`), for Postman collections
 * (plan 1795712849115 task 11).
 *
 * Each `run.executions[]` entry is one request, and a request is the test: its `assertions[]`
 * (the collection's `pm.test` blocks) are its steps. A request fails when an assertion failed
 * or the request itself errored (`requestError`: refused, timed out, DNS). A request with no
 * assertions asserted nothing, so it is `no-assertions`, which is `unknown` and not a pass.
 *
 * A collection run with several iterations (a data file) runs each request once per
 * iteration. Those are different inputs, not retries, so each iteration is its own test.
 */

const LABEL = 'Newman JSON report';

function assertionsOf(execution: Json): StepInput[] {
  return list(execution['assertions']).flatMap((item) => {
    const assertion = record(item);
    if (assertion === null) return [];
    const error = record(assertion['error']);
    const rawStatus =
      assertion['skipped'] === true ? 'skipped' : error === null ? 'passed' : 'failed';
    return [
      {
        name: textOf(assertion['assertion']) || 'assertion',
        rawStatus,
        ...(error === null
          ? {}
          : { message: `${textOf(error['name'])}: ${textOf(error['message'])}`.trim() }),
      },
    ];
  });
}

function verdict(steps: readonly StepInput[], requestError: Json | null): string {
  if (requestError !== null || steps.some((step) => step.rawStatus === 'failed')) return 'failed';
  if (steps.length === 0) return 'no-assertions';
  return steps.every((step) => step.rawStatus === 'skipped') ? 'skipped' : 'passed';
}

export const newmanJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.newman+json',
  parse(input, context) {
    const document = record(parseJsonDocument(input, LABEL));
    const run = record(document?.['run']);
    if (run === null || !Array.isArray(run['executions'])) {
      throw new Error(`${LABEL} has no run.executions array`);
    }
    const collection = textOf(record(record(document?.['collection'])?.['info'])?.['name']);
    const iterations = durationOf(record(record(run['stats'])?.['iterations'])?.['total']) ?? 1;
    const tests: TestInput[] = list(run['executions']).flatMap((item) => {
      const execution = record(item);
      const name = textOf(record(execution?.['item'])?.['name']);
      if (execution === null || name === '') return [];
      const steps = assertionsOf(execution);
      const requestError = record(execution['requestError']);
      const rawStatus = verdict(steps, requestError);
      const iteration = durationOf(record(execution['cursor'])?.['iteration']) ?? 0;
      const failure =
        requestError === null
          ? steps.find((step) => step.message !== undefined)?.message
          : `request failed: ${textOf(requestError['message']) || textOf(requestError['code'])}`;
      return [
        {
          file: relativePath(
            collection === '' ? 'collection.json' : `${collection}.postman_collection.json`,
          ),
          describePath: [],
          title: name,
          ...(iterations > 1 ? { project: `iteration ${String(iteration + 1)}` } : {}),
          attempts: [
            {
              rawStatus,
              status: statusOf('newman', rawStatus),
              durationMs: durationOf(record(execution['response'])?.['responseTime']),
              ...(failure === undefined ? {} : { message: failure }),
              steps,
            },
          ],
        },
      ];
    });
    const failures = list(run['failures']).flatMap((item) => {
      const failure = record(item);
      const error = record(failure?.['error']);
      // A failure in a collection-level script has no request to attach to.
      return failure !== null && record(failure['source']) === null && error !== null
        ? [{ message: textOf(error['message']) }]
        : [];
    });
    return testResultsRun(tests, 'newman', 'packages/reporter newman-json', context, failures);
  },
};
