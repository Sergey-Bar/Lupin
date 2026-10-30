import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from '../../router.js';
import { Route } from './now.js';

/**
 * The landing route. `/` redirects here (AGENTS.md, "Landing page"), so this file is the
 * first thing a person opens. What it owns is where it is mounted and that it builds the
 * three sources `Now` ranks from — runs, the portfolio and the deliveries — from the real
 * clients. The screen itself is tested in `components/Now.test.tsx`.
 */
const RENDER_TIMEOUT_MS = 15_000;

function stubFetch(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Now route', () => {
  it('is mounted at /dashboard/now', () => {
    expect(Route.fullPath).toBe('/dashboard/now');
  });

  it(
    'is where / lands, and asks for the runs, the portfolio and the deliveries',
    async () => {
      const asked = stubFetch();
      window.scrollTo = () => undefined;
      render(<MemoryRouter initialEntries={['/']} />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: RENDER_TIMEOUT_MS,
      });
      await waitFor(
        () => {
          expect(asked.some((url) => url.includes('/runs'))).toBe(true);
          expect(asked.some((url) => url.includes('portfolio'))).toBe(true);
          expect(asked.some((url) => url.includes('deliveries'))).toBe(true);
        },
        { timeout: RENDER_TIMEOUT_MS },
      );
    },
    RENDER_TIMEOUT_MS * 2,
  );
});
