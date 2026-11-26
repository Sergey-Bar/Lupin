import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { nunitXmlAdapter } from './nunit-xml.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://nunit',
  sourceDigest: 'e'.repeat(64),
  producerVersion: '3.18.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};
const encode = (text: string) => new TextEncoder().encode(text);

/** As `nunit3-console` writes `TestResult.xml`. */
const NUNIT = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="0" testcasecount="4" result="Failed" total="4" passed="1" failed="1" skipped="1" inconclusive="1" engine-version="3.18.0">
  <test-suite type="Assembly" id="0-1004" name="Shop.Tests.dll" fullname="/src/bin/Shop.Tests.dll" result="Failed">
    <test-suite type="TestSuite" id="0-1005" name="Shop" fullname="Shop">
      <test-suite type="TestFixture" id="0-1000" name="CartTests" fullname="Shop.CartTests" classname="Shop.CartTests">
        <test-case id="0-1001" name="AddsItem" fullname="Shop.CartTests.AddsItem" methodname="AddsItem" classname="Shop.CartTests" result="Passed" start-time="2026-11-26T10:00:01.0000000Z" duration="0.021" asserts="1" />
        <test-case id="0-1002" name="AppliesCoupon" fullname="Shop.CartTests.AppliesCoupon" result="Failed" duration="0.112">
          <failure>
            <message><![CDATA[  Expected: 90
  But was:  100
]]></message>
            <stack-trace><![CDATA[at Shop.CartTests.AppliesCoupon() in /src/CartTests.cs:line 30]]></stack-trace>
          </failure>
        </test-case>
        <test-case id="0-1003" name="UsesTheBank" fullname="Shop.CartTests.UsesTheBank" result="Skipped" label="Ignored" duration="0">
          <reason><message><![CDATA[Bank sandbox is down]]></message></reason>
        </test-case>
        <test-case id="0-1006" name="Maybe" fullname="Shop.CartTests.Maybe" result="Inconclusive" duration="0.001" />
      </test-suite>
    </test-suite>
  </test-suite>
</test-run>`;

describe('the NUnit 3 adapter', () => {
  const result = nunitXmlAdapter.parse(encode(NUNIT), context);
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it('reads each test case under its assembly and fixtures', () => {
    expect(byTitle.get('AddsItem')).toMatchObject({
      status: 'passed',
      durationMs: 21,
      specPath: 'Shop.Tests.dll',
      describePath: ['Shop', 'CartTests'],
      startedAt: '2026-11-26T10:00:01.000Z',
    });
  });

  it('keeps the failure message and stack, and the reason a test was skipped', () => {
    expect(byTitle.get('AppliesCoupon')?.status).toBe('failed');
    expect(byTitle.get('AppliesCoupon')?.error?.message).toMatch(/Expected: 90[\s\S]*line 30/u);
    expect(byTitle.get('UsesTheBank')).toMatchObject({ status: 'skipped' });
    expect(byTitle.get('UsesTheBank')?.error?.message).toBe('Bank sandbox is down');
  });

  it('reads Inconclusive as unknown, never as a pass', () => {
    expect(byTitle.get('Maybe')?.status).toBe('unknown');
    expect(result.status).toBe('failed');
  });

  it.each([
    ['NUnit 2 XML', '<test-results name="x"><test-suite/></test-results>', /NUnit 2/u],
    ['a TRX', '<TestRun><Results/></TestRun>', /<test-run>/u],
    [
      'a run with no cases',
      '<test-run><test-suite type="Assembly" name="a.dll"/></test-run>',
      /no tests/u,
    ],
  ])('refuses %s', (_name, body, message) => {
    expect(() => nunitXmlAdapter.parse(encode(body), context)).toThrow(message);
  });
});
