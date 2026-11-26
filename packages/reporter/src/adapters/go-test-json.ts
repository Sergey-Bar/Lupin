import type { ProducerAdapter } from '../adapter.js';
import { record } from './json-fields.js';
import {
  durationOf,
  relativePath,
  statusOf,
  testResultsRun,
  textOf,
  type TestInput,
} from './test-results-json.js';

/**
 * `go test -json` output (test2json), one JSON event per line (plan 1795712849115 task 11).
 *
 * Each test ends on a `pass`, `fail` or `skip` event carrying `Elapsed` seconds; its `output`
 * events before that are its log, and the log of a failed or skipped test is its message.
 * A subtest `TestLogin/expired_token` is the test `expired_token` under `TestLogin`. The
 * package is the file, because Go names tests by package.
 *
 * A test that started and never ended (the binary panicked or timed out) is a failure, with
 * the package's own output as the reason, never a test that vanished. A package that failed
 * with no test (a build error) is a report error. `-count=N` runs a test N times, and those
 * runs are its attempts.
 */

const LABEL = 'go test -json output';
const MAX_LOG = 8_192;
const TERMINAL = new Set(['pass', 'fail', 'skip']);

interface Running {
  pkg: string;
  name: string;
  log: string;
  startedAt?: string;
}

const key = (pkg: string, name: string): string => `${pkg}\u0000${name}`;

function testOf(run: Running, rawStatus: string, elapsed: unknown, log: string): TestInput {
  const segments = run.name.split('/');
  const title = segments.pop() ?? run.name;
  const seconds = durationOf(elapsed);
  return {
    file: relativePath(run.pkg === '' ? 'unknown' : run.pkg),
    describePath: segments,
    title,
    attempts: [
      {
        rawStatus,
        status: statusOf('go', rawStatus),
        ...(seconds === undefined ? {} : { durationMs: Math.round(seconds * 1000) }),
        ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
        ...(rawStatus === 'pass' ? {} : { message: log.slice(-MAX_LOG) }),
      },
    ],
  };
}

export const goTestJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.go-test+json',
  parse(input, context) {
    const lines = new TextDecoder().decode(input).split(/\r?\n/u);
    const running = new Map<string, Running>();
    const packageLog = new Map<string, string>();
    const tests: TestInput[] = [];
    const errors: { message: string }[] = [];
    let events = 0;
    for (const line of lines) {
      if (line.trim() === '') continue;
      let event: ReturnType<typeof record>;
      try {
        event = record(JSON.parse(line) as unknown);
      } catch {
        // `go test -json` interleaves the odd non-JSON line (a build tool's own output);
        // skipping it is what `test2json`'s own consumers do.
        continue;
      }
      if (event === null) continue;
      events += 1;
      const action = textOf(event['Action']);
      const pkg = textOf(event['Package']);
      const name = textOf(event['Test']);
      const output = typeof event['Output'] === 'string' ? event['Output'] : '';
      if (name === '') {
        if (action === 'output') packageLog.set(pkg, `${packageLog.get(pkg) ?? ''}${output}`);
        if (action === 'fail' && ![...running.values()].some((run) => run.pkg === pkg)) {
          const hadTests = tests.some((test) => test.file === relativePath(pkg));
          if (!hadTests) errors.push({ message: `${pkg}: ${(packageLog.get(pkg) ?? '').trim()}` });
        }
        continue;
      }
      const id = key(pkg, name);
      if (action === 'run') {
        const time = textOf(event['Time']);
        running.set(id, { pkg, name, log: '', ...(time === '' ? {} : { startedAt: time }) });
      } else if (action === 'output') {
        const run = running.get(id);
        if (run !== undefined) run.log += output;
      } else if (TERMINAL.has(action)) {
        const run = running.get(id) ?? { pkg, name, log: '' };
        running.delete(id);
        tests.push(testOf(run, action, event['Elapsed'], run.log));
      }
    }
    if (events === 0) throw new Error(`${LABEL} has no JSON events`);
    for (const run of running.values()) {
      const why = (packageLog.get(run.pkg) ?? '').trim() || 'the test started and never finished';
      tests.push(testOf(run, 'fail', undefined, `${run.log}${why}`));
    }
    return testResultsRun(tests, 'go', 'packages/reporter go-test-json', context, errors);
  },
};
