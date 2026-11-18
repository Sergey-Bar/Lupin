/**
 * A JUnit report the size of a real monorepo suite: `count` test cases over 200 files, with a
 * failure every 97th, attribute shapes as Surefire, Jest and Vitest write them. Deterministic,
 * so the size a test records is the size every host produces.
 *
 */
/** `stamp` is an ISO timestamp, so two reports of one suite are two runs. */
export function largeJunit(count: number, stamp: string): string {
  const cases: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const module = index % 200;
    const failed = index % 97 === 0;
    cases.push(
      `<testcase classname="suite.module${module}" name="does thing number ${index} correctly" ` +
        `file="tests/module${module}.test.ts" time="0.0${index % 9}">` +
        (failed
          ? `<failure message="expected ${index} to equal ${index + 1}">AssertionError: expected ${index} to equal ${index + 1}\n    at tests/module${module}.test.ts:${(index % 300) + 1}:7</failure>`
          : '') +
        '</testcase>',
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="all" tests="${count}" ` +
    `timestamp="${stamp}">${cases.join('')}</testsuite></testsuites>`
  );
}
