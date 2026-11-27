import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { trxDurationMs, trxXmlAdapter } from './trx-xml.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://trx',
  sourceDigest: 'd'.repeat(64),
  producerVersion: '17.12.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};

const encode = (text: string) => new TextEncoder().encode(text);

/** The shape `dotnet test --logger trx` writes, trimmed to what matters and a little more. */
const TRX = `<?xml version="1.0" encoding="utf-8"?>
<TestRun id="5f0c" name="ci@runner 2026-11-26" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Times creation="2026-11-26T10:00:00.0000000+00:00" />
  <Results>
    <UnitTestResult executionId="e1" testId="t1" testName="Adds two numbers" computerName="ci" duration="00:00:00.0123456" startTime="2026-11-26T10:00:01.0000000+00:00" outcome="Passed" />
    <UnitTestResult executionId="e2" testId="t2" testName="Divides by zero" computerName="ci" duration="00:00:01.5000000" startTime="2026-11-26T10:00:02.0000000+00:00" outcome="Failed">
      <Output>
        <ErrorInfo>
          <Message>Assert.Throws() Failure: No exception was thrown</Message>
          <StackTrace>   at Calc.Tests.MathTests.DividesByZero() in /src/MathTests.cs:line 21</StackTrace>
        </ErrorInfo>
      </Output>
    </UnitTestResult>
    <UnitTestResult executionId="e3" testId="t3" testName="Uses the network" duration="00:00:00" outcome="NotExecuted" />
    <UnitTestResult executionId="e4" testId="t4" testName="Rounds" duration="00:00:00.2" outcome="Passed">
      <InnerResults>
        <UnitTestResult executionId="e4a" testId="t4" testName="Rounds (1.5)" duration="00:00:00.1" outcome="Passed" />
        <UnitTestResult executionId="e4b" testId="t4" testName="Rounds (2.5)" duration="00:00:00.1" outcome="Failed" />
      </InnerResults>
    </UnitTestResult>
  </Results>
  <TestDefinitions>
    <UnitTest name="Adds two numbers" storage="/src/bin/Debug/net9.0/Calc.Tests.dll" id="t1"><TestMethod codeBase="Calc.Tests.dll" className="Calc.Tests.MathTests" name="Adds" /></UnitTest>
    <UnitTest name="Divides by zero" storage="/src/bin/Debug/net9.0/Calc.Tests.dll" id="t2"><TestMethod codeBase="Calc.Tests.dll" className="Calc.Tests.MathTests" name="DividesByZero" /></UnitTest>
    <UnitTest name="Uses the network" storage="C:\\src\\bin\\Calc.Tests.dll" id="t3"><TestMethod codeBase="Calc.Tests.dll" className="Calc.Tests.NetTests" name="Network" /></UnitTest>
    <UnitTest name="Rounds" storage="/src/bin/Debug/net9.0/Calc.Tests.dll" id="t4"><TestMethod codeBase="Calc.Tests.dll" className="Calc.Tests.MathTests" name="Rounds" /></UnitTest>
  </TestDefinitions>
  <ResultSummary outcome="Failed">
    <Counters total="5" executed="4" passed="2" failed="2" notExecuted="1" />
  </ResultSummary>
</TestRun>`;

describe('trxDurationMs', () => {
  it.each([
    ['00:00:00.0123456', 12],
    ['00:00:01.5000000', 1500],
    ['01:02:03', 3_723_000],
    ['', undefined],
    ['1.5', undefined],
  ])('reads %j as %s ms', (value, expected) => {
    expect(trxDurationMs(value)).toBe(expected);
  });
});

describe('the TRX adapter', () => {
  const result = trxXmlAdapter.parse(encode(TRX), context);
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it('reads every executed test, the inner results of a data-driven one instead of their parent', () => {
    expect([...byTitle.keys()].sort()).toEqual([
      'Adds two numbers',
      'Divides by zero',
      'Rounds (1.5)',
      'Rounds (2.5)',
      'Uses the network',
    ]);
  });

  it('maps outcomes, durations and the failure message', () => {
    expect(byTitle.get('Adds two numbers')).toMatchObject({ status: 'passed', durationMs: 12 });
    const failed = byTitle.get('Divides by zero');
    expect(failed).toMatchObject({ status: 'failed', durationMs: 1500, rawStatus: 'Failed' });
    expect(failed?.error?.message).toContain('No exception was thrown');
    expect(failed?.error?.message).toContain('MathTests.cs:line 21');
    expect(byTitle.get('Uses the network')?.status).toBe('skipped');
  });

  it('names the assembly as the file and the class as the describe path', () => {
    expect(byTitle.get('Divides by zero')).toMatchObject({
      specPath: 'Calc.Tests.dll',
      describePath: ['Calc', 'Tests', 'MathTests'],
    });
    // A Windows storage path reduces to the same assembly name.
    expect(byTitle.get('Uses the network')?.specPath).toBe('Calc.Tests.dll');
  });

  it('fails the run when a test failed', () => {
    expect(result.status).toBe('failed');
  });

  it('reads two results for one test as its attempts, and a pass after a failure as flaky', () => {
    const retried = TRX.replace(
      '<UnitTestResult executionId="e3"',
      '<UnitTestResult executionId="e2b" testId="t2" testName="Divides by zero" duration="00:00:00.1" outcome="Passed" /><UnitTestResult executionId="e3"',
    );
    const flaky = trxXmlAdapter.parse(encode(retried), context);
    const attempts = flaky.attempts.filter((attempt) => attempt.title === 'Divides by zero');
    expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);
    expect(attempts.every((attempt) => attempt.flakiness === 'observed')).toBe(true);
  });

  it.each([
    ['a JUnit document', '<testsuites><testsuite name="x"/></testsuites>', /<TestRun>/u],
    ['broken XML', '<TestRun><Results>', /well-formed/u],
    ['a run with no results', '<TestRun><Results/></TestRun>', /no tests/u],
    ['a run with no Results element', '<TestRun/>', /<Results>/u],
  ])('refuses %s rather than reporting an empty run', (_name, body, message) => {
    expect(() => trxXmlAdapter.parse(encode(body), context)).toThrow(message);
  });
});
