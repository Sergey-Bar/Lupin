import type { ProducerAdapter } from '../adapter.js';
import { list, record, type Json } from './json-fields.js';
import {
  parseJsonDocument,
  relativePath,
  statusOf,
  testResultsRun,
  textOf,
  type StepInput,
  type TestInput,
} from './test-results-json.js';

/**
 * A Lighthouse report (`lighthouse <url> --output json`, or one `lhci` result), the LHR
 * (plan 1795712849115 task 11).
 *
 * Each scored category (Performance, Accessibility, Best practices, SEO) is a test, banded the
 * way Lighthouse colours it: 90 or above is `good` and passes, 50 to 89 `needs-improvement`
 * and below 50 `poor` both fail. A category Lighthouse could not score (`score: null`) is
 * `unscored`, which is unknown and not a pass. The category's audits that scored below 90
 * are its steps, so the run says which audit cost the points.
 *
 * The page is the file, by host and path, so one page's history is one test per category.
 * A `runtimeError` (the page did not load) is a report error, and Lighthouse writes `null`
 * scores beside it, so the categories read as unknown rather than passing.
 */

const LABEL = 'Lighthouse report';
const GOOD = 0.9;
const POOR = 0.5;

export function lighthouseBand(score: unknown): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'unscored';
  if (score >= GOOD) return 'good';
  return score >= POOR ? 'needs-improvement' : 'poor';
}

function pageOf(lhr: Json): string {
  const url =
    textOf(lhr['finalDisplayedUrl']) || textOf(lhr['finalUrl']) || textOf(lhr['requestedUrl']);
  try {
    const parsed = new URL(url);
    return relativePath(`${parsed.host}${parsed.pathname}`);
  } catch {
    return relativePath(url === '' ? 'page' : url);
  }
}

function auditsBelow(category: Json, audits: Json | null): StepInput[] {
  return list(category['auditRefs']).flatMap((item) => {
    const ref = record(item);
    const audit = record(audits?.[textOf(ref?.['id'])]);
    if (
      ref === null ||
      audit === null ||
      (typeof ref['weight'] === 'number' && ref['weight'] === 0)
    ) {
      return [];
    }
    const mode = textOf(audit['scoreDisplayMode']);
    if (mode !== 'binary' && mode !== 'numeric' && mode !== 'metricSavings') return [];
    const band = lighthouseBand(audit['score']);
    if (band === 'good' || band === 'unscored') return [];
    const value = textOf(audit['displayValue']);
    return [
      {
        name: textOf(audit['title']) || textOf(ref['id']),
        rawStatus: band,
        ...(value === '' ? {} : { message: value }),
      },
    ];
  });
}

export const lighthouseJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.lighthouse+json',
  parse(input, context) {
    const lhr = record(parseJsonDocument(input, LABEL));
    const categories = record(lhr?.['categories']);
    if (lhr === null || categories === null || textOf(lhr['lighthouseVersion']) === '') {
      throw new Error(`${LABEL} has no lighthouseVersion and categories`);
    }
    const audits = record(lhr['audits']);
    const file = pageOf(lhr);
    const fetchedAt = Date.parse(textOf(lhr['fetchTime']));
    const tests: TestInput[] = Object.values(categories).flatMap((value) => {
      const category = record(value);
      const title = textOf(category?.['title']);
      if (category === null || title === '') return [];
      const rawStatus = lighthouseBand(category['score']);
      const score = category['score'];
      return [
        {
          file,
          describePath: [],
          title,
          attempts: [
            {
              rawStatus,
              status: statusOf('lighthouse', rawStatus),
              ...(Number.isFinite(fetchedAt)
                ? { startedAt: new Date(fetchedAt).toISOString() }
                : {}),
              ...(typeof score === 'number' && rawStatus !== 'good'
                ? { message: `Scored ${String(Math.round(score * 100))}; 90 is good.` }
                : {}),
              steps: auditsBelow(category, audits),
            },
          ],
        },
      ];
    });
    const runtime = record(lhr['runtimeError']);
    const errors =
      runtime === null || textOf(runtime['code']) === 'NO_ERROR'
        ? []
        : [{ message: `${textOf(runtime['code'])}: ${textOf(runtime['message'])}` }];
    return testResultsRun(
      tests,
      'lighthouse',
      'packages/reporter lighthouse-json',
      context,
      errors,
    );
  },
};
