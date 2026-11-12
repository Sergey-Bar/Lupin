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
  type StepInput,
  type TestInput,
} from './test-results-json.js';

/**
 * pytest-json-report output (`pytest --json-report`): `{ "tests": [{ "nodeid", "outcome",
 * "setup", "call", "teardown" }] }`.
 *
 * The node id is the identity: `tests/test_pay.py::TestCard::test_pays[visa]` is the file
 * `tests/test_pay.py`, the describe path `TestCard`, and the title `test_pays[visa]`. The
 * three phases are the test's steps, and the first phase with a crash or a `longrepr` carries
 * the error. pytest-rerunfailures writes an earlier attempt as another entry with the same
 * node id and outcome `rerun`; those are the test's attempts, in the order written.
 */

const LABEL = 'pytest-json-report';
const PHASES = ['setup', 'call', 'teardown'] as const;

function longreprOf(value: unknown): string {
  if (typeof value === 'string') return value;
  const message = textOf(record(record(value)?.['reprcrash'])?.['message']);
  return message;
}

function attemptOf(entry: Json): AttemptInput {
  const rawStatus = textOf(entry['outcome']);
  const phases = PHASES.flatMap((name) => {
    const phase = record(entry[name]);
    return phase === null ? [] : [{ name, phase }];
  });
  const steps: StepInput[] = phases.map(({ name, phase }) => ({
    name,
    rawStatus: textOf(phase['outcome']),
    message: textOf(record(phase['crash'])?.['message']) || longreprOf(phase['longrepr']),
  }));
  const durations = phases.map(({ phase }) => durationOf(phase['duration']));
  const seconds = durations.every((value) => value === undefined)
    ? undefined
    : durations.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return {
    rawStatus,
    status: statusOf('pytest', rawStatus),
    durationMs: seconds === undefined ? undefined : seconds * 1_000,
    message: steps.find((step) => (step.message ?? '') !== '')?.message,
    steps,
  };
}

function testOf(entry: Json): TestInput | null {
  const nodeid = textOf(entry['nodeid']);
  if (nodeid === '') return null;
  const [file = '', ...rest] = nodeid.split('::');
  const title = rest.at(-1) ?? file;
  return {
    file: relativePath(file),
    describePath: rest.slice(0, -1),
    title,
    attempts: [attemptOf(entry)],
  };
}

export const pytestJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.pytest-json-report+json',
  parse(input, context) {
    const document = record(parseJsonDocument(input, LABEL));
    if (document === null || !Array.isArray(document['tests'])) {
      throw new Error(`${LABEL} has no tests array`);
    }
    const tests = list(document['tests'])
      .map(record)
      .flatMap((entry) => (entry === null ? [] : [testOf(entry)]))
      .filter((test): test is TestInput => test !== null);
    const reportErrors = list(document['collectors']).flatMap((item) => {
      const collector = record(item);
      return textOf(collector?.['outcome']) === 'failed'
        ? [
            {
              message: `${textOf(collector?.['nodeid']) || 'collection'}: ${longreprOf(collector?.['longrepr']) || 'failed to collect'}`,
            },
          ]
        : [];
    });
    return testResultsRun(tests, 'pytest', 'packages/reporter pytest-json', context, reportErrors);
  },
};
