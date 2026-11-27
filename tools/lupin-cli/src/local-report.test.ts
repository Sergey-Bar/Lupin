import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from './check-command.js';
import { EXIT } from './errors.js';
import {
  analyse,
  causeOf,
  parseJunit,
  parsePlaywright,
  parseReport,
  renderHtml,
  renderMarkdown,
  renderText,
} from './local-report.js';

const JUNIT = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="cart">
    <testcase classname="cart" name="adds an item" time="0.120"/>
    <testcase classname="cart" name="totals the basket" time="1.5">
      <failure message="expected 500 to be 200">stack</failure>
    </testcase>
    <testcase classname="cart" name="applies a coupon &amp; tax" time="0.3">
      <error><![CDATA[expected 503 to be 200]]></error>
    </testcase>
    <testcase classname="cart" name="retries" time="0.4"><flakyFailure message="timeout"/></testcase>
    <testcase classname="cart" name="later"><skipped/></testcase>
  </testsuite>
</testsuites>`;

const PLAYWRIGHT = JSON.stringify({
  suites: [
    {
      title: 'login.spec.ts',
      file: 'login.spec.ts',
      specs: [
        {
          title: 'signs in',
          tests: [
            {
              projectName: 'chromium',
              results: [
                {
                  status: 'failed',
                  duration: 100,
                  error: { message: '\u001b[31mTimeout 5000ms exceeded\u001b[39m' },
                },
                { status: 'passed', duration: 80 },
              ],
            },
          ],
        },
        {
          title: 'signs out',
          tests: [
            {
              projectName: 'chromium',
              results: [
                { status: 'failed', duration: 50, error: { message: 'locator not found' } },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('reading reports', () => {
  it('reads JUnit outcomes, entities, CDATA and Surefire flaky reruns', () => {
    const tests = parseJunit(JUNIT);
    expect(tests.map((test) => [test.title, test.outcome])).toEqual([
      ['adds an item', 'passed'],
      ['totals the basket', 'failed'],
      ['applies a coupon & tax', 'failed'],
      ['retries', 'flaky'],
      ['later', 'skipped'],
    ]);
    expect(tests[0]).toMatchObject({ key: 'cart › adds an item', durationMs: 120 });
    expect(tests[2]?.message).toBe('expected 503 to be 200');
  });

  it('reads Playwright retries as flaky and strips colour codes', () => {
    const tests = parsePlaywright(PLAYWRIGHT);
    expect(tests[0]).toMatchObject({
      key: 'login.spec.ts › signs in › [chromium]',
      outcome: 'flaky',
      message: 'Timeout 5000ms exceeded',
      durationMs: 180,
    });
    expect(tests[1]?.outcome).toBe('failed');
  });

  it('refuses a file that is neither', () => {
    expect(() => parseReport('x.txt', 'hello')).toThrow(/not a JUnit XML or JSON test report/u);
  });
});

describe('analysis', () => {
  it('groups failures that differ only in values into one cause', () => {
    expect(causeOf('expected 500 to be 200')).toBe(causeOf('expected 503 to be 201'));
    expect(causeOf("can't find '#a'")).not.toBe(causeOf('timeout'));
    const analysis = analyse([parseReport('j.xml', JUNIT)]);
    expect(analysis).toMatchObject({
      verdict: 'red',
      total: 5,
      passed: 1,
      failed: 2,
      flaky: 1,
      skipped: 1,
    });
    expect(analysis.causes).toHaveLength(1);
    expect(analysis.causes[0]?.count).toBe(2);
  });

  it('finds a test that flips between runs, and judges the newest result', () => {
    const run = (outcome: string) =>
      parseReport(
        'r.xml',
        `<testsuite><testcase classname="a" name="t">${outcome}</testcase></testsuite>`,
      );
    const fail = run('<failure message="x"/>');
    const analysis = analyse([run(''), fail, run('')]);
    expect(analysis.verdict).toBe('flaky');
    expect(analysis.failed).toBe(0);
    // One change is a fix or a regression, not a flake.
    expect(analyse([fail, run('')]).flakyTests).toEqual([]);
    expect(analyse([run(''), fail]).verdict).toBe('red');
    expect(analysis.flakyTests).toEqual([
      { key: 'a › t', evidence: 'passed 2, failed 1 across runs' },
    ]);
  });

  it('calls a report with no tests empty, never green', () => {
    expect(analyse([parseReport('e.xml', '<testsuites/>')]).verdict).toBe('empty');
  });
});

describe('lupin check', () => {
  const io = (cwd: string) => {
    const out: string[] = [];
    return {
      out,
      io: {
        env: {},
        cwd,
        fetch: globalThis.fetch,
        out: (line: string) => out.push(line),
        now: () => new Date(),
      },
    };
  };

  it('prints the verdict and causes, writes HTML, and exits 1 on a failure', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lupin-check-'));
    writeFileSync(path.join(dir, 'j.xml'), JUNIT);
    const { out, io: context } = io(dir);
    expect(await check(['--html', 'r.html', '--', 'j.xml'], context)).toBe(EXIT.gateFailed);
    expect(out.join('\n')).toMatch(/^RED: tests are failing\./u);
    expect(out.join('\n')).toMatch(/2 failure\(s\), 1 distinct cause/u);
    expect(readFileSync(path.join(dir, 'r.html'), 'utf8')).toMatch(/<h1>RED/u);
  });

  it('passes flaky by default and fails it on request', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lupin-check-'));
    writeFileSync(
      path.join(dir, 'f.xml'),
      '<testsuite><testcase name="t"><flakyFailure/></testcase></testsuite>',
    );
    expect(await check(['--', 'f.xml'], io(dir).io)).toBe(EXIT.ok);
    expect(await check(['--fail-on-flaky', '--', 'f.xml'], io(dir).io)).toBe(EXIT.gateFailed);
  });

  it('is a usage error with no report or an unreadable one', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lupin-check-'));
    await expect(check([], io(dir).io)).rejects.toMatchObject({ exitCode: EXIT.usage });
    await expect(check(['--', 'missing.xml'], io(dir).io)).rejects.toMatchObject({
      exitCode: EXIT.usage,
    });
  });
});

describe('edges', () => {
  it('drops everything after a comment that never closes', () => {
    expect(parseJunit('<testcase name="a"/><!-- <testcase name="b"/>')).toHaveLength(1);
  });

  it('ignores tests inside comments, nested ones included', () => {
    expect(
      parseJunit(
        '<!-- <testcase name="gone"/> --><testsuite><!--<!-- x -->--><testcase name="kept"/></testsuite>',
      ).map((test) => test.title),
    ).toEqual(['kept']);
  });

  it('decodes numeric entities and single-quoted attributes, and tolerates a bad time', () => {
    const [test] = parseJunit(
      "<testcase name='a&#x41;&#66;' file='f.ts' time='soon'><error/></testcase>",
    );
    expect(test).toMatchObject({
      key: 'f.ts › aAB',
      durationMs: null,
      message: 'failed with no message',
    });
  });

  it('reads Playwright skips, timeouts, nested suites, errors[] and a test with no project', () => {
    const tests = parsePlaywright(
      JSON.stringify({
        suites: [
          {
            title: 'a.spec.ts',
            file: 'a.spec.ts',
            suites: [
              {
                title: 'group',
                specs: [
                  { title: 'skips', tests: [{ results: [{ status: 'skipped' }] }] },
                  {
                    title: 'times out',
                    tests: [{ results: [{ status: 'timedOut', errors: [{ message: 'slow' }] }] }],
                  },
                  { title: 'silent', tests: [{ results: [{ status: 'failed' }] }] },
                  { tests: [{}] },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(tests.map((test) => [test.key, test.outcome, test.message])).toEqual([
      ['a.spec.ts › group › skips', 'skipped', null],
      ['a.spec.ts › group › times out', 'failed', 'slow'],
      ['a.spec.ts › group › silent', 'failed', 'failed with no message'],
      ['a.spec.ts › group › (unnamed)', 'skipped', null],
    ]);
  });

  it('renders every verdict, long causes, and passes on a green run', async () => {
    const cases = Array.from(
      { length: 5 },
      (_v, i) => `<testcase name="t${String(i)}"><failure message="boom"/></testcase>`,
    );
    const red = analyse([parseReport('r.xml', `<testsuite>${cases.join('')}</testsuite>`)]);
    expect(renderText(red)).toMatch(/and 2 more/u);
    for (const xml of ['<testsuite><testcase name="g" time="2"/></testsuite>', '<testsuites/>']) {
      const analysis = analyse([parseReport('x.xml', xml)]);
      expect(renderHtml(analysis)).toMatch(/<h1>/u);
      expect(renderText(analysis)).toMatch(/^(GREEN|EMPTY)/u);
    }
    expect(
      renderText(
        analyse([parseReport('s.xml', '<testsuite><testcase name="g" time="2"/></testsuite>')]),
      ),
    ).toMatch(/2\.0s/u);
    const dir = mkdtempSync(path.join(tmpdir(), 'lupin-check-'));
    writeFileSync(path.join(dir, 'g.xml'), '<testsuite><testcase name="g"/></testsuite>');
    writeFileSync(path.join(dir, 'bad.txt'), 'nope');
    const out: string[] = [];
    const context = {
      env: {},
      cwd: dir,
      fetch: globalThis.fetch,
      out: (line: string) => out.push(line),
      now: () => new Date(),
    };
    expect(await check(['--json', '--html', 'g.html', '--', 'g.xml'], context)).toBe(EXIT.ok);
    expect(JSON.parse(out[0] ?? '{}')).toMatchObject({ verdict: 'green' });
    await expect(check(['--', 'bad.txt'], context)).rejects.toMatchObject({ exitCode: EXIT.usage });
  });
});

describe('lupin check --demo and --markdown', () => {
  it('finds one cause behind four failures, a retry and a flip, in the built-in runs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lupin-check-'));
    const out: string[] = [];
    const context = {
      env: {},
      cwd: dir,
      fetch: globalThis.fetch,
      out: (line: string) => out.push(line),
      now: () => new Date(),
    };
    expect(await check(['--demo', '--markdown', 'summary.md'], context)).toBe(EXIT.gateFailed);
    const text = out.join('\n');
    expect(text).toMatch(/^RED: tests are failing\./u);
    expect(text).toMatch(/4 failure\(s\), 1 distinct cause/u);
    expect(text).toMatch(/updates the address - passed on a retry/u);
    expect(text).toMatch(/signs in - passed 2, failed 1 across runs/u);
    // Failing now after passing before is a regression to fix, never a flake to quarantine.
    expect(text).toMatch(/Flaky tests \(2\)/u);
    expect(text).not.toMatch(/pays by card - passed/u);
    const markdown = readFileSync(path.join(dir, 'summary.md'), 'utf8');
    expect(markdown).toMatch(/^### :x: RED: tests are failing\./u);
    expect(markdown).toMatch(/\| 4 \| `expected status 502/u);
    expect(
      renderMarkdown(
        analyse([
          parseReport('w.xml', '<testcase name="a|b"><failure message="C:\\x `y`"/></testcase>'),
        ]),
      ),
    ).toMatch(/\| `C:\\\\x 'y'` \| a\\\|b \|/u);
  });

  it('refuses --demo beside report files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lupin-check-'));
    const context = {
      env: {},
      cwd: dir,
      fetch: globalThis.fetch,
      out: () => undefined,
      now: () => new Date(),
    };
    await expect(check(['--demo', '--', 'x.xml'], context)).rejects.toMatchObject({
      exitCode: EXIT.usage,
    });
  });
});
