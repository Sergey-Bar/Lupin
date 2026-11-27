import type { ProducerAdapter } from '../adapter.js';
import { relativePath, statusOf, testResultsRun, type TestInput } from './test-results-json.js';
import {
  childrenNamed,
  descendantsNamed,
  parseXmlTree,
  textAt,
  type XmlElement,
} from './xml-tree.js';

/**
 * xUnit.net v2 XML (`dotnet test --logger "xunit"`, or the console runner's `-xml`)
 * (plan 1795712849115 task 11).
 *
 * `<assemblies><assembly name="…/Calc.Tests.dll"><collection><test …/>`. A test's `type` is its
 * class and `method` its method; `name` is the display name, which for a theory carries the
 * arguments, so each row of a theory is its own test. The assembly is the file and the class's
 * namespace path is the describe path. An `<errors>` block holds failures outside any test (a
 * fixture that threw), and those become report errors rather than vanishing.
 */

const LABEL = 'xUnit.net report';

/** The assemblies a report holds: a root `<assemblies>`, a bare `<assembly>`, or none. */
function assembliesOf(root: XmlElement): XmlElement[] | null {
  if (root.name === 'assemblies') return childrenNamed(root, 'assembly');
  return root.name === 'assembly' ? [root] : null;
}

/** The assembly's file name, without the build directory it was run from. */
function fileOf(assembly: XmlElement): string {
  const file = (assembly.attributes['name'] ?? '').replaceAll('\\', '/').split('/').at(-1) ?? '';
  return relativePath(file === '' ? 'unknown.dll' : file);
}

/** Seconds as a duration, when the report gave a usable number. */
function durationOf(raw: string | undefined): { durationMs?: number } {
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? { durationMs: Math.round(seconds * 1000) } : {};
}

function testOf(test: XmlElement, file: string): TestInput | null {
  const title = (test.attributes['name'] ?? '').trim();
  if (title === '') return null;
  const rawStatus = (test.attributes['result'] ?? '').trim();
  const type = (test.attributes['type'] ?? '').trim();
  const message = [
    textAt(test, ['failure', 'message']),
    textAt(test, ['failure', 'stack-trace']),
    textAt(test, ['reason']),
  ]
    .filter((part) => part !== '')
    .join('\n');
  return {
    file,
    describePath: type === '' ? [] : type.split('.'),
    title,
    attempts: [
      {
        rawStatus,
        status: statusOf('xunit', rawStatus),
        ...durationOf(test.attributes['time']),
        message,
      },
    ],
  };
}

function errorOf(error: XmlElement): { message: string } {
  const name = error.attributes['name'] ?? error.attributes['type'] ?? 'error';
  return { message: `${name}: ${textAt(error, ['failure', 'message'])}` };
}

export const xunitXmlAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.xunit+xml',
  parse(input, context) {
    const assemblies = assembliesOf(parseXmlTree(input, LABEL));
    if (assemblies === null) throw new Error(`${LABEL} has no <assemblies> root element`);
    const tests: TestInput[] = [];
    const errors: { message: string }[] = [];
    for (const assembly of assemblies) {
      const file = fileOf(assembly);
      for (const test of descendantsNamed(assembly, 'test')) {
        const read = testOf(test, file);
        if (read !== null) tests.push(read);
      }
      errors.push(...descendantsNamed(assembly, 'error').map(errorOf));
    }
    return testResultsRun(tests, 'xunit', 'packages/reporter xunit-xml', context, errors);
  },
};
