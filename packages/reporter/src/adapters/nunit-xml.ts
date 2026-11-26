import type { ProducerAdapter } from '../adapter.js';
import { relativePath, statusOf, testResultsRun, type TestInput } from './test-results-json.js';
import { childNamed, parseXmlTree, textAt, type XmlElement } from './xml-tree.js';

/**
 * NUnit 3 result XML (`TestResult.xml`, `nunit3-console` or `dotnet test --logger nunit`)
 * (plan 1795712849115 task 11).
 *
 * `<test-run>` nests `<test-suite>` elements: an assembly, then namespaces and fixtures, and the
 * `<test-case>` elements are the tests. The assembly suite is the file and the fixtures and
 * namespaces above a case are its describe path. A failure's `<message>` and `<stack-trace>`
 * are the error; a skip's `<reason>` is kept as its message, because "ignored because the
 * database is down" is the evidence.
 *
 * NUnit 2's `<test-results>` root is a different schema and is refused with that said, rather
 * than read as an empty run.
 */

const LABEL = 'NUnit 3 report';

function casesUnder(
  node: XmlElement,
  assembly: string,
  path: readonly string[],
  out: TestInput[],
): void {
  for (const child of node.children) {
    if (child.name === 'test-suite') {
      const type = child.attributes['type'] ?? '';
      const name = (child.attributes['name'] ?? '').trim();
      if (type === 'Assembly') casesUnder(child, name, [], out);
      else casesUnder(child, assembly, name === '' ? path : [...path, name], out);
    } else if (child.name === 'test-case') {
      const title = (child.attributes['name'] ?? '').trim();
      if (title === '') continue;
      const rawStatus = (child.attributes['result'] ?? '').trim();
      const started = Date.parse(child.attributes['start-time'] ?? '');
      const seconds = Number(child.attributes['duration']);
      const message = [
        textAt(child, ['failure', 'message']),
        textAt(child, ['failure', 'stack-trace']),
        textAt(child, ['reason', 'message']),
      ]
        .filter((part) => part !== '')
        .join('\n');
      out.push({
        file: relativePath(assembly === '' ? 'unknown.dll' : assembly),
        describePath: [...path],
        title,
        attempts: [
          {
            rawStatus,
            status: statusOf('nunit', rawStatus),
            ...(Number.isFinite(seconds) && seconds >= 0
              ? { durationMs: Math.round(seconds * 1000) }
              : {}),
            ...(Number.isFinite(started) ? { startedAt: new Date(started).toISOString() } : {}),
            message,
          },
        ],
      });
    }
  }
}

export const nunitXmlAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.nunit3+xml',
  parse(input, context) {
    const root = parseXmlTree(input, LABEL);
    if (root.name === 'test-results') {
      throw new Error(
        `${LABEL}: this is NUnit 2 XML; write NUnit 3 results (--result:TestResult.xml)`,
      );
    }
    if (root.name !== 'test-run') throw new Error(`${LABEL} has no <test-run> root element`);
    const tests: TestInput[] = [];
    casesUnder(root, '', [], tests);
    const setup = childNamed(root, 'failure');
    const errors = setup === undefined ? [] : [{ message: textAt(setup, ['message']) }];
    return testResultsRun(tests, 'nunit', 'packages/reporter nunit-xml', context, errors);
  },
};
