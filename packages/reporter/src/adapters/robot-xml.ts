import type { ProducerAdapter } from '../adapter.js';
import { relativePath, statusOf, testResultsRun, type TestInput } from './test-results-json.js';
import { childNamed, childrenNamed, parseXmlTree, type XmlElement } from './xml-tree.js';

/**
 * Robot Framework `output.xml`, versions 6 and 7 (plan 1795712849115 task 11).
 *
 * `<robot>` holds nested `<suite>` elements and each `<test>` is a test. A test's verdict is its
 * **own** `<status>` child, not a keyword's: keywords nest their own `<status>` inside `<kw>`,
 * and reading the first one found would report a test by its first step. Robot 7 writes
 * `start` and `elapsed` (seconds); Robot 6 writes `starttime` and `endtime` as
 * `20261126 10:00:00.123`. Both are read.
 *
 * Suite sources are absolute paths on the machine that ran them, so a test's file is its
 * suite's source relative to the top suite's directory. Otherwise the same test would have a
 * different identity on every runner.
 */

const LABEL = 'Robot Framework output';

/** `20261126 10:00:00.123` (Robot 6) or an ISO time (Robot 7), as epoch milliseconds. */
export function robotTimeMs(value: string | undefined): number {
  const raw = (value ?? '').trim();
  if (raw === '') return Number.NaN;
  // Robot 6: eight digits of date, a space, then the time.
  if (raw.charAt(8) === ' ' && /^\d{8}$/u.test(raw.slice(0, 8))) {
    return Date.parse(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9)}Z`);
  }
  // Robot 7 writes local time with no zone; it is read as UTC, as Robot 6's was.
  const zoned = raw.endsWith('Z') || raw.endsWith('z') || /[+-]\d\d:?\d\d$/u.test(raw);
  return Date.parse(zoned ? raw : `${raw}Z`);
}

function timing(status: XmlElement | undefined): { startedAt?: string; durationMs?: number } {
  if (status === undefined) return {};
  const start = robotTimeMs(status.attributes['start'] ?? status.attributes['starttime']);
  const elapsed = Number(status.attributes['elapsed']);
  const end = robotTimeMs(status.attributes['endtime']);
  const durationMs = Number.isFinite(elapsed)
    ? Math.round(elapsed * 1000)
    : Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, end - start)
      : undefined;
  return {
    ...(Number.isFinite(start) ? { startedAt: new Date(start).toISOString() } : {}),
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

const directory = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  return /\.[A-Za-z0-9]+$/u.test(normalized)
    ? normalized.slice(0, normalized.lastIndexOf('/') + 1)
    : `${normalized.replace(/\/$/u, '')}/`;
};

function testsIn(
  suite: XmlElement,
  base: string,
  path: readonly string[],
  file: string,
  out: TestInput[],
): void {
  const name = (suite.attributes['name'] ?? '').trim();
  const here = name === '' ? path : [...path, name];
  const source = (suite.attributes['source'] ?? '').replaceAll('\\', '/');
  const ownFile =
    source !== '' && /\.(robot|txt|tsv|resource|rst)$/iu.test(source)
      ? source.startsWith(base)
        ? source.slice(base.length)
        : source
      : file;
  for (const child of childrenNamed(suite, 'suite')) testsIn(child, base, here, ownFile, out);
  for (const test of childrenNamed(suite, 'test')) {
    const title = (test.attributes['name'] ?? '').trim();
    if (title === '') continue;
    const status = childNamed(test, 'status');
    const rawStatus = (status?.attributes['status'] ?? '').trim();
    out.push({
      file: relativePath(ownFile === '' ? 'suite.robot' : ownFile),
      describePath: [...here],
      title,
      attempts: [
        {
          rawStatus,
          status: statusOf('robot', rawStatus),
          ...timing(status),
          message: status?.text.trim() ?? '',
        },
      ],
    });
  }
}

export const robotXmlAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.robotframework+xml',
  parse(input, context) {
    const root = parseXmlTree(input, LABEL);
    if (root.name !== 'robot') throw new Error(`${LABEL} has no <robot> root element`);
    const tests: TestInput[] = [];
    for (const suite of childrenNamed(root, 'suite')) {
      testsIn(suite, directory(suite.attributes['source'] ?? ''), [], '', tests);
    }
    const errors = childrenNamed(childNamed(root, 'errors') ?? root, 'msg')
      .filter((message) => message.attributes['level'] === 'ERROR')
      .map((message) => ({ message: message.text }));
    return testResultsRun(tests, 'robot', 'packages/reporter robot-xml', context, errors);
  },
};
