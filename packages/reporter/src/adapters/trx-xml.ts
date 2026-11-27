import type { ProducerAdapter } from '../adapter.js';
import {
  relativePath,
  statusOf,
  testResultsRun,
  type AttemptInput,
  type TestInput,
} from './test-results-json.js';
import { childNamed, childrenNamed, descendantsNamed, parseXmlTree, textAt } from './xml-tree.js';

/**
 * VSTest TRX (`dotnet test --logger trx`), the format MSTest, xUnit and NUnit all write under
 * `dotnet test` (plan 1795712849115 task 11).
 *
 * `<Results>` holds one `<UnitTestResult>` per execution, keyed by `testId` onto the
 * `<UnitTest>` in `<TestDefinitions>` that names the class and the assembly. A data-driven test
 * writes a parent result with `<InnerResults>`; the inner ones are the tests, and the parent is
 * only their summary, so it is not counted twice. A retried test (`--retry` in a test adapter)
 * writes several results for one `testId`, and they become that test's attempts.
 *
 * TRX names no source file. The assembly is the file, and the class's namespace path is the
 * describe path, so a test's identity is stable across runs of the same build.
 */

const LABEL = 'TRX report';

/** `hh:mm:ss.fffffff`, as TRX writes a duration, in milliseconds. */
export function trxDurationMs(value: string | undefined): number | undefined {
  const parts = (value ?? '').trim().split(':');
  if (parts.length !== 3) return undefined;
  const [hours = '', minutes = '', seconds = ''] = parts;
  const [whole = '', fraction, extra] = seconds.split('.');
  const digits = (text: string): boolean => /^\d+$/u.test(text);
  const valid =
    digits(hours) &&
    minutes.length === 2 &&
    digits(minutes) &&
    whole.length === 2 &&
    digits(whole) &&
    extra === undefined &&
    (fraction === undefined || digits(fraction));
  if (!valid) return undefined;
  return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
}

interface Definition {
  className: string;
  storage: string;
}

function definitions(root: ReturnType<typeof parseXmlTree>): Map<string, Definition> {
  const byId = new Map<string, Definition>();
  for (const test of descendantsNamed(root, 'UnitTest')) {
    const method = childNamed(test, 'TestMethod');
    byId.set(test.attributes['id'] ?? '', {
      className: method?.attributes['className'] ?? '',
      storage: test.attributes['storage'] ?? '',
    });
  }
  return byId;
}

function attemptOf(result: ReturnType<typeof parseXmlTree>): AttemptInput {
  const rawStatus = (result.attributes['outcome'] ?? '').trim();
  const startTime = result.attributes['startTime'];
  const started = startTime === undefined ? Number.NaN : Date.parse(startTime);
  const message = [
    textAt(result, ['Output', 'ErrorInfo', 'Message']),
    textAt(result, ['Output', 'ErrorInfo', 'StackTrace']),
  ]
    .filter((part) => part !== '')
    .join('\n');
  return {
    rawStatus,
    status: statusOf('vstest', rawStatus),
    durationMs: trxDurationMs(result.attributes['duration']),
    ...(Number.isFinite(started) ? { startedAt: new Date(started).toISOString() } : {}),
    message,
  };
}

/** The results that are tests: a data-driven parent stands for its inner results. */
function leafResults(
  results: ReturnType<typeof parseXmlTree>[],
): ReturnType<typeof parseXmlTree>[] {
  return results.flatMap((result) => {
    const inner = childNamed(result, 'InnerResults');
    const children = inner === undefined ? [] : childrenNamed(inner, 'UnitTestResult');
    return children.length === 0 ? [result] : leafResults(children);
  });
}

export const trxXmlAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.ms-trx+xml',
  parse(input, context) {
    const root = parseXmlTree(input, LABEL);
    if (root.name !== 'TestRun') throw new Error(`${LABEL} has no <TestRun> root element`);
    const results = childNamed(root, 'Results');
    if (results === undefined) throw new Error(`${LABEL} has no <Results> element`);
    const byId = definitions(root);
    const tests: TestInput[] = leafResults(childrenNamed(results, 'UnitTestResult')).flatMap(
      (result) => {
        const title = (result.attributes['testName'] ?? '').trim();
        if (title === '') return [];
        const definition = byId.get(result.attributes['testId'] ?? '');
        const className = definition?.className ?? '';
        const assembly = (definition?.storage ?? '').replaceAll('\\', '/').split('/').at(-1) ?? '';
        return [
          {
            file: relativePath(assembly === '' ? 'unknown.dll' : assembly),
            describePath: className === '' ? [] : className.split('.'),
            title,
            attempts: [attemptOf(result)],
          },
        ];
      },
    );
    const runErrors = descendantsNamed(childNamed(root, 'ResultSummary') ?? root, 'RunInfo')
      .filter((info) => info.attributes['outcome'] === 'Error')
      .map((info) => ({ message: textAt(info, ['Text']) }));
    return testResultsRun(tests, 'vstest', 'packages/reporter trx-xml', context, runErrors);
  },
};
