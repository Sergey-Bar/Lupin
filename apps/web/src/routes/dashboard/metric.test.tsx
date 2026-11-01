import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../../router.js';
import { cockpitFixture } from '../../test-utils.js';
import { Route } from './metric.js';

const RENDER_TIMEOUT_MS = 15_000;

function stubFetch(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const body = url.includes('/api/v1/cockpit') ? JSON.stringify(cockpitFixture()) : '[]';
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the metric route', () => {
  it('is mounted at /dashboard/metric/$metricId', () => {
    expect(Route.fullPath).toBe('/dashboard/metric/$metricId');
  });

  it(
    'opens the metric a link names, in the window the link names',
    async () => {
      const asked = stubFetch();
      window.scrollTo = () => undefined;
      render(<MemoryRouter initialEntries={['/dashboard/metric/coverage?window=release']} />);
      await waitFor(
        () =>
          expect(screen.getByRole('heading', { level: 1, name: 'Coverage' })).toBeInTheDocument(),
        { timeout: RENDER_TIMEOUT_MS },
      );
      await waitFor(
        () =>
          expect(asked.some((url) => url.includes('/api/v1/cockpit?window=release'))).toBe(true),
        { timeout: RENDER_TIMEOUT_MS },
      );
      expect(await screen.findByTestId('metric-summary')).toBeInTheDocument();
    },
    RENDER_TIMEOUT_MS * 2,
  );

  it(
    'falls back to the last 7 days for a window it does not know',
    async () => {
      const asked = stubFetch();
      window.scrollTo = () => undefined;
      render(<MemoryRouter initialEntries={['/dashboard/metric/tests?window=forever']} />);
      await waitFor(
        () => expect(asked.some((url) => url.includes('/api/v1/cockpit?window=7d'))).toBe(true),
        { timeout: RENDER_TIMEOUT_MS },
      );
      expect(asked.some((url) => url.includes('forever'))).toBe(false);
    },
    RENDER_TIMEOUT_MS * 2,
  );
});
