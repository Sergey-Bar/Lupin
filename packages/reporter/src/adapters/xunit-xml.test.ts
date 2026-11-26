import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { xunitXmlAdapter } from './xunit-xml.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://xunit',
  sourceDigest: 'f'.repeat(64),
  producerVersion: '2.9.2',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};
const encode = (text: string) => new TextEncoder().encode(text);

/** As the xUnit.net v2 console runner writes `-xml results.xml`. */
const XUNIT = `<?xml version="1.0" encoding="utf-8"?>
<assemblies timestamp="11/26/2026 10:00:00">
  <assembly name="C:\\src\\bin\\Debug\\net9.0\\Calc.Tests.dll" environment="64-bit .NET" test-framework="xUnit.net 2.9.2" total="4" passed="1" failed="1" skipped="1">
    <errors>
      <error type="fixture-cleanup" name="Calc.Tests.DbFixture">
        <failure exception-type="System.IO.IOException"><message><![CDATA[database file is locked]]></message></failure>
      </error>
    </errors>
    <collection total="4" passed="1" failed="1" skipped="1" name="Test collection for Calc.Tests.MathTests" time="0.120">
      <test name="Calc.Tests.MathTests.Adds" type="Calc.Tests.MathTests" method="Adds" time="0.0042" result="Pass" />
      <test name="Calc.Tests.MathTests.Divides(a: 1, b: 0)" type="Calc.Tests.MathTests" method="Divides" time="0.0510" result="Fail">
        <failure exception-type="Xunit.Sdk.ThrowsException">
          <message><![CDATA[Assert.Throws() Failure: No exception was thrown]]></message>
          <stack-trace><![CDATA[   at Calc.Tests.MathTests.Divides(Int32 a, Int32 b) in /src/MathTests.cs:line 18]]></stack-trace>
        </failure>
      </test>
      <test name="Calc.Tests.MathTests.Divides(a: 4, b: 2)" type="Calc.Tests.MathTests" method="Divides" time="0.001" result="Pass" />
      <test name="Calc.Tests.MathTests.Network" type="Calc.Tests.MathTests" method="Network" time="0" result="Skip">
        <reason><![CDATA[needs the staging API]]></reason>
      </test>
    </collection>
  </assembly>
</assemblies>`;

describe('the xUnit.net adapter', () => {
  const result = xunitXmlAdapter.parse(encode(XUNIT), context);
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it('reads each row of a theory as its own test, not as attempts of one', () => {
    expect(byTitle.get('Calc.Tests.MathTests.Divides(a: 1, b: 0)')?.status).toBe('failed');
    expect(byTitle.get('Calc.Tests.MathTests.Divides(a: 4, b: 2)')?.status).toBe('passed');
    expect(result.attempts.every((attempt) => attempt.flakiness === 'unknown')).toBe(true);
  });

  it('names the assembly from a Windows path, and the class as the describe path', () => {
    expect(byTitle.get('Calc.Tests.MathTests.Adds')).toMatchObject({
      specPath: 'Calc.Tests.dll',
      describePath: ['Calc', 'Tests', 'MathTests'],
      durationMs: 4,
    });
  });

  it('keeps the failure, the skip reason, and a fixture error outside any test', () => {
    expect(byTitle.get('Calc.Tests.MathTests.Divides(a: 1, b: 0)')?.error?.message).toContain(
      'No exception was thrown',
    );
    expect(byTitle.get('Calc.Tests.MathTests.Network')).toMatchObject({ status: 'skipped' });
    expect(byTitle.get('Calc.Tests.MathTests.Network')?.error?.message).toBe(
      'needs the staging API',
    );
    expect(JSON.stringify(result)).toContain('database file is locked');
  });

  it.each([
    ['JUnit XML', '<testsuites/>', /<assemblies>/u],
    ['no tests', '<assemblies><assembly name="a.dll"/></assemblies>', /no tests/u],
  ])('refuses %s', (_name, body, message) => {
    expect(() => xunitXmlAdapter.parse(encode(body), context)).toThrow(message);
  });
});
