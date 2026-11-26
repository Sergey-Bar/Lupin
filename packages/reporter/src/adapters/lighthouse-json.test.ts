import { describe, expect, it } from 'vitest';
import type { ProducerContext } from '../adapter.js';
import { lighthouseBand, lighthouseJsonAdapter } from './lighthouse-json.js';

const context: ProducerContext = {
  workspaceId: 'workspace-1',
  runId: 'run-1',
  sourceUri: 'upload://lighthouse',
  sourceDigest: 'e'.repeat(64),
  producerVersion: '12.8.0',
  adapterVersion: '1.0.0',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:01:00.000Z',
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** An LHR as `lighthouse --output json` writes it, cut to two categories and a few audits. */
const LHR = {
  lighthouseVersion: '12.8.0',
  requestedUrl: 'https://shop.example.com/pricing?ref=x',
  finalDisplayedUrl: 'https://shop.example.com/pricing',
  fetchTime: '2026-11-26T10:00:05.000Z',
  runtimeError: { code: 'NO_ERROR', message: '' },
  categories: {
    performance: {
      id: 'performance',
      title: 'Performance',
      score: 0.72,
      auditRefs: [
        { id: 'largest-contentful-paint', weight: 25 },
        { id: 'total-blocking-time', weight: 30 },
        { id: 'diagnostics', weight: 0 },
      ],
    },
    accessibility: {
      id: 'accessibility',
      title: 'Accessibility',
      score: 0.98,
      auditRefs: [{ id: 'color-contrast', weight: 7 }],
    },
    seo: { id: 'seo', title: 'SEO', score: null, auditRefs: [] },
  },
  audits: {
    'largest-contentful-paint': {
      title: 'Largest Contentful Paint',
      score: 0.41,
      scoreDisplayMode: 'numeric',
      displayValue: '4.1 s',
    },
    'total-blocking-time': {
      title: 'Total Blocking Time',
      score: 0.95,
      scoreDisplayMode: 'numeric',
      displayValue: '90 ms',
    },
    diagnostics: { title: 'Diagnostics', score: null, scoreDisplayMode: 'informative' },
    'color-contrast': {
      title: 'Background and foreground colors have sufficient contrast',
      score: 1,
      scoreDisplayMode: 'binary',
    },
  },
};

describe('lighthouseBand', () => {
  it.each([
    [1, 'good'],
    [0.9, 'good'],
    [0.89, 'needs-improvement'],
    [0.5, 'needs-improvement'],
    [0.49, 'poor'],
    [null, 'unscored'],
    [Number.NaN, 'unscored'],
  ])('%s is %s', (score, band) => {
    expect(lighthouseBand(score)).toBe(band);
  });
});

describe('the Lighthouse adapter', () => {
  const result = lighthouseJsonAdapter.parse(encode(LHR), context);
  const byTitle = new Map(result.attempts.map((attempt) => [attempt.title, attempt]));

  it('reads each category as a test, banded the way Lighthouse colours it', () => {
    expect(byTitle.get('Accessibility')?.status).toBe('passed');
    expect(byTitle.get('Performance')?.status).toBe('failed');
    expect(byTitle.get('Performance')?.error?.message).toBe('Scored 72; 90 is good.');
    expect(byTitle.get('SEO')?.status).toBe('unknown');
    expect(result.status).toBe('failed');
  });

  it('lists the audits that cost a category its points, and only those', () => {
    const steps = result.steps.filter((step) => step.id.includes('Performance'));
    expect(steps.map((step) => step.id.split('. ').at(-1))).toEqual(['Largest Contentful Paint']);
    expect(steps[0]?.error?.message).toBe('4.1 s');
  });

  it('names the page by host and path, without its query string', () => {
    expect(byTitle.get('Performance')?.specPath).toBe('shop.example.com/pricing');
    expect(byTitle.get('Performance')?.startedAt).toBe('2026-11-26T10:00:05.000Z');
  });

  it('reports a page that did not load, with its unscored categories as unknown', () => {
    const failed = lighthouseJsonAdapter.parse(
      encode({
        ...LHR,
        runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' },
        categories: { performance: { ...LHR.categories.performance, score: null } },
      }),
      context,
    );
    expect(failed.attempts[0]?.status).toBe('unknown');
    expect(JSON.stringify(failed)).toContain('NO_FCP');
  });

  it('refuses a document that is not a Lighthouse report', () => {
    expect(() => lighthouseJsonAdapter.parse(encode({ categories: {} }), context)).toThrow(
      /lighthouseVersion/u,
    );
  });
});
