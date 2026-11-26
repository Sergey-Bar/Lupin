import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { robotTimeMs, robotXmlAdapter } from './robot-xml.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://robot',
  sourceDigest: 'a'.repeat(64),
  producerVersion: '7.1',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};
const encode = (text: string) => new TextEncoder().encode(text);

/** Robot Framework 7's output.xml: `start` and `elapsed` on every `<status>`. */
const ROBOT7 = `<?xml version="1.0" encoding="UTF-8"?>
<robot generator="Robot 7.1 (Python 3.12.3 on linux)" generated="2026-11-26T10:00:00.000000" rpa="false" schemaversion="5">
<suite id="s1" name="Tests" source="/home/ci/work/app/tests">
<suite id="s1-s1" name="Login" source="/home/ci/work/app/tests/login.robot">
<test id="s1-s1-t1" name="Valid Login" line="8">
<kw name="Open Browser"><status status="FAIL" start="2026-11-26T10:00:01.000000" elapsed="0.5"/></kw>
<status status="PASS" start="2026-11-26T10:00:01.000000" elapsed="2.250"/>
</test>
<test id="s1-s1-t2" name="Locked Account" line="14">
<kw name="Login"><status status="FAIL" start="2026-11-26T10:00:04.000000" elapsed="0.1">Element 'id=error' not visible</status></kw>
<status status="FAIL" start="2026-11-26T10:00:04.000000" elapsed="1.000">Element 'id=error' not visible after 5 seconds.</status>
</test>
<test id="s1-s1-t3" name="Two Factor" line="20">
<status status="SKIP" start="2026-11-26T10:00:06.000000" elapsed="0.0">Skipped with --skip.</status>
</test>
<status status="FAIL" start="2026-11-26T10:00:01.000000" elapsed="5.1"/>
</suite>
<status status="FAIL" start="2026-11-26T10:00:00.900000" elapsed="5.2"/>
</suite>
<errors>
<msg time="2026-11-26T10:00:00.500000" level="ERROR">Error in file 'resources/common.resource' on line 4: Unknown setting 'Documantation'.</msg>
<msg time="2026-11-26T10:00:00.600000" level="WARN">Keyword 'Old Kw' is deprecated.</msg>
</errors>
</robot>`;

describe('robotTimeMs', () => {
  it('reads Robot 6 and Robot 7 times', () => {
    expect(robotTimeMs('20261126 10:00:01.500')).toBe(Date.parse('2026-11-26T10:00:01.500Z'));
    expect(robotTimeMs('2026-11-26T10:00:01.500000')).toBe(Date.parse('2026-11-26T10:00:01.500Z'));
    expect(robotTimeMs('')).toBeNaN();
  });
});

describe('the Robot Framework adapter', () => {
  const result = robotXmlAdapter.parse(encode(ROBOT7), context);
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it("reads a test's own status, not its first keyword's", () => {
    // `Open Browser` failed inside a test that passed (a keyword retried with Wait Until).
    expect(byTitle.get('Valid Login')).toMatchObject({ status: 'passed', durationMs: 2250 });
  });

  it('names the file relative to the top suite, so the identity is the same on every runner', () => {
    expect(byTitle.get('Locked Account')).toMatchObject({
      specPath: 'login.robot',
      describePath: ['Tests', 'Login'],
    });
  });

  it("keeps the test's message, its skip, and an ERROR from the run's errors", () => {
    expect(byTitle.get('Locked Account')?.error?.message).toBe(
      "Element 'id=error' not visible after 5 seconds.",
    );
    expect(byTitle.get('Two Factor')?.status).toBe('skipped');
    const serialised = JSON.stringify(result);
    expect(serialised).toContain('Unknown setting');
    expect(serialised).not.toContain('deprecated');
  });

  it('reads Robot 6 starttime and endtime when there is no elapsed', () => {
    const robot6 = `<robot generator="Robot 6.1"><suite name="S" source="/x/s.robot"><test name="T"><status status="PASS" starttime="20261126 10:00:00.000" endtime="20261126 10:00:01.250"/></test></suite></robot>`;
    const attempt = robotXmlAdapter.parse(encode(robot6), context).attempts[0];
    expect(attempt).toMatchObject({ status: 'passed', durationMs: 1250, specPath: 's.robot' });
  });

  it.each([
    ['a JUnit document', '<testsuites/>', /<robot>/u],
    ['an empty run', '<robot><suite name="S"/></robot>', /no tests/u],
  ])('refuses %s', (_name, body, message) => {
    expect(() => robotXmlAdapter.parse(encode(body), context)).toThrow(message);
  });
});
