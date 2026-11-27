/**
 * The JSON test reports `lupin check` reads besides Playwright's: Jest and Vitest (`--json`),
 * CTRF, Mochawesome (Cypress, Mocha) and pytest-json-report. Each is told apart by the shape
 * its writer documents, never by the file name.
 */
import type { Outcome, TestResult } from './local-report.js';

type Json = Record<string, unknown>;

const record = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function firstLine(message: string | null): string | null {
  if (message === null) return null;
  return message.trim().split(/\r?\n/u)[0]?.slice(0, 300) ?? null;
}

function key(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' › ');
}

function result(
  keyText: string,
  title: string,
  outcome: Outcome,
  durationMs: number | null,
  message: string | null,
): TestResult {
  const fallback = outcome === 'failed' ? 'failed with no message' : null;
  return {
    key: keyText,
    title,
    outcome,
    durationMs,
    message: outcome === 'failed' ? (firstLine(message) ?? fallback) : null,
  };
}

/** A path made relative to the repository, the way a person names the file. */
function relative(file: string): string {
  const posix = file.replace(/\\/gu, '/');
  const marker = /\/(?:src|tests?|spec|e2e|cypress|packages|apps)\//u.exec(posix);
  return marker === null ? posix.replace(/^\/+/u, '') : posix.slice(marker.index + 1);
}

function outcomeOf(status: string | null): Outcome {
  if (status === 'passed' || status === 'pass') return 'passed';
  if (status === 'failed' || status === 'fail' || status === 'error' || status === 'timedOut')
    return 'failed';
  return 'skipped';
}

function jest(root: Json): TestResult[] {
  return list(root['testResults']).flatMap((file) => {
    const suite = record(file) ?? {};
    const name = relative(text(suite['name']) ?? text(suite['testFilePath']) ?? '');
    return list(suite['assertionResults']).map((entry) => {
      const test = record(entry) ?? {};
      const title = text(test['title']) ?? '(unnamed)';
      const ancestors = list(test['ancestorTitles']).filter(
        (item): item is string => typeof item === 'string',
      );
      const messages = list(test['failureMessages']).filter(
        (item): item is string => typeof item === 'string',
      );
      return result(
        key(name, ...ancestors, title),
        title,
        outcomeOf(text(test['status'])),
        number(test['duration']),
        messages[0] ?? null,
      );
    });
  });
}

function ctrf(results: Json): TestResult[] {
  return list(results['tests']).map((entry) => {
    const test = record(entry) ?? {};
    const title = text(test['name']) ?? '(unnamed)';
    let outcome = outcomeOf(text(test['status']));
    if (outcome === 'passed' && test['flaky'] === true) outcome = 'flaky';
    return result(
      key(text(test['filePath']), text(test['suite']), title),
      title,
      outcome,
      number(test['duration']),
      text(test['message']),
    );
  });
}

function mochawesome(root: Json): TestResult[] {
  const tests: TestResult[] = [];
  const walk = (suite: Json, path: string[], file: string | null) => {
    const at = text(suite['file']) ?? file;
    const here = text(suite['title']) === null ? path : [...path, text(suite['title']) ?? ''];
    for (const entry of list(suite['tests'])) {
      const test = record(entry) ?? {};
      const title = text(test['title']) ?? '(unnamed)';
      const state = test['pending'] === true ? 'pending' : text(test['state']);
      tests.push(
        result(
          key(at, ...here, title),
          title,
          outcomeOf(state),
          number(test['duration']),
          text(record(test['err'])?.['message']),
        ),
      );
    }
    for (const child of list(suite['suites'])) walk(record(child) ?? {}, here, at);
  };
  for (const suite of list(root['results'])) walk(record(suite) ?? {}, [], null);
  return tests;
}

function pytestMessage(test: Json): string | null {
  for (const stage of ['call', 'setup', 'teardown']) {
    const phase = record(test[stage]);
    const message = text(record(phase?.['crash'])?.['message']) ?? text(phase?.['longrepr']);
    if (message !== null) return message;
  }
  return null;
}

function pytest(root: Json): TestResult[] {
  return list(root['tests']).map((entry) => {
    const test = record(entry) ?? {};
    const [file = '', ...rest] = (text(test['nodeid']) ?? '(unnamed)').split('::');
    const title = rest.join('::') || file;
    const seconds = number(record(test['call'])?.['duration']);
    return result(
      key(rest.length === 0 ? null : file, title),
      title,
      outcomeOf(text(test['outcome'])),
      seconds === null ? null : Math.round(seconds * 1000),
      pytestMessage(test),
    );
  });
}

/** Tests from a JSON report other than Playwright's, or `null` when no reader knows its shape. */
export function parseOtherJson(root: Json): TestResult[] | null {
  if (Array.isArray(root['testResults'])) return jest(root);
  const ctrfResults = record(root['results']);
  if (ctrfResults !== null && Array.isArray(ctrfResults['tests'])) return ctrf(ctrfResults);
  if (Array.isArray(root['results']) && record(root['stats']) !== null) return mochawesome(root);
  if (
    Array.isArray(root['tests']) &&
    list(root['tests']).some((test) => text(record(test)?.['nodeid']) !== null)
  ) {
    return pytest(root);
  }
  return null;
}
