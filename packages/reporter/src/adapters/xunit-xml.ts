import type { ProducerAdapter } from '../adapter.js';
import { relativePath, statusOf, testResultsRun, type TestInput } from './test-results-json.js';
import { childrenNamed, descendantsNamed, parseXmlTree, textAt } from './xml-tree.js';

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

export const xunitXmlAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.xunit+xml',
  parse(input, context) {
    const root = parseXmlTree(input, LABEL);
    const assemblies =
      root.name === 'assemblies'
        ? childrenNamed(root, 'assembly')
        : root.name === 'assembly'
          ? [root]
          : null;
    if (assemblies === null) throw new Error(`${LABEL} has no <assemblies> root element`);
    const tests: TestInput[] = [];
    const errors: { message: string }[] = [];
    for (const assembly of assemblies) {
      const file =
        (assembly.attributes['name'] ?? '').replaceAll('\\', '/').split('/').at(-1) ?? '';
      for (const test of descendantsNamed(assembly, 'test')) {
        const title = (test.attributes['name'] ?? '').trim();
        if (title === '') continue;
        const rawStatus = (test.attributes['result'] ?? '').trim();
        const seconds = Number(test.attributes['time']);
        const type = (test.attributes['type'] ?? '').trim();
        const message = [
          textAt(test, ['failure', 'message']),
          textAt(test, ['failure', 'stack-trace']),
          textAt(test, ['reason']),
        ]
          .filter((part) => part !== '')
          .join('\n');
        tests.push({
          file: relativePath(file === '' ? 'unknown.dll' : file),
          describePath: type === '' ? [] : type.split('.'),
          title,
          attempts: [
            {
              rawStatus,
              status: statusOf('xunit', rawStatus),
              ...(Number.isFinite(seconds) && seconds >= 0
                ? { durationMs: Math.round(seconds * 1000) }
                : {}),
              message,
            },
          ],
        });
      }
      for (const error of descendantsNamed(assembly, 'error')) {
        const name = error.attributes['name'] ?? error.attributes['type'] ?? 'error';
        errors.push({ message: `${name}: ${textAt(error, ['failure', 'message'])}` });
      }
    }
    return testResultsRun(tests, 'xunit', 'packages/reporter xunit-xml', context, errors);
  },
};
