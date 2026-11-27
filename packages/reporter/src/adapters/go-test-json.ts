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

/** Reads test2json events in order, keeping what each running test has logged so far. */
class GoEventReader {
  readonly running = new Map<string, Running>();
  readonly packageLog = new Map<string, string>();
  readonly tests: TestInput[] = [];
  readonly errors: { message: string }[] = [];
  events = 0;

  /** One line of output; a line that is not a JSON object is skipped, as test2json's consumers do. */
  line(line: string): void {
    if (line.trim() === '') return;
    let event: ReturnType<typeof record>;
    try {
      event = record(JSON.parse(line) as unknown);
    } catch {
      // `go test -json` interleaves the odd non-JSON line (a build tool's own output).
      return;
    }
    if (event === null) return;
    this.events += 1;
    const action = textOf(event['Action']);
    const pkg = textOf(event['Package']);
    const name = textOf(event['Test']);
    const output = typeof event['Output'] === 'string' ? event['Output'] : '';
    if (name === '') this.packageEvent(action, pkg, output);
    else this.testEvent(event, action, pkg, name, output);
  }

  /** A package's own output, and a package that failed with no test in it (a build error). */
  private packageEvent(action: string, pkg: string, output: string): void {
    if (action === 'output') this.packageLog.set(pkg, `${this.packageLog.get(pkg) ?? ''}${output}`);
    if (action !== 'fail' || [...this.running.values()].some((run) => run.pkg === pkg)) return;
    if (this.tests.some((test) => test.file === relativePath(pkg))) return;
    this.errors.push({ message: `${pkg}: ${(this.packageLog.get(pkg) ?? '').trim()}` });
  }

  private testEvent(
    event: Record<string, unknown>,
    action: string,
    pkg: string,
    name: string,
    output: string,
  ): void {
    const id = key(pkg, name);
    if (action === 'run') {
      const time = textOf(event['Time']);
      this.running.set(id, { pkg, name, log: '', ...(time === '' ? {} : { startedAt: time }) });
      return;
    }
    if (action === 'output') {
      const run = this.running.get(id);
      if (run !== undefined) run.log += output;
      return;
    }
    if (!TERMINAL.has(action)) return;
    const run = this.running.get(id) ?? { pkg, name, log: '' };
    this.running.delete(id);
    this.tests.push(testOf(run, action, event['Elapsed'], run.log));
  }

  /** A test that started and never ended is a failure, with its package's output as the reason. */
  unfinished(): void {
    for (const run of this.running.values()) {
      const why =
        (this.packageLog.get(run.pkg) ?? '').trim() || 'the test started and never finished';
      this.tests.push(testOf(run, 'fail', undefined, `${run.log}${why}`));
    }
  }
}

export const goTestJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.go-test+json',
  parse(input, context) {
    const reader = new GoEventReader();
    for (const line of new TextDecoder().decode(input).split(/\r?\n/u)) reader.line(line);
    if (reader.events === 0) throw new Error(`${LABEL} has no JSON events`);
    reader.unfinished();
    return testResultsRun(
      reader.tests,
      'go',
      'packages/reporter go-test-json',
      context,
      reader.errors,
    );
  },
};
