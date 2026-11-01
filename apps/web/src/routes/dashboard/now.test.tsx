import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from '../../router.js';
import { cockpitFixture } from '../../test-utils.js';
import { Route } from './now.js';

/**
 * The landing route. `/` redirects here (AGENTS.md, "Landing page"), so this file is the
 * first thing a person opens. What it owns is where it is mounted and that it builds the
 * three sources `Now` ranks from — runs, the portfolio and the deliveries — from the real
 * clients. The screen itself is tested in `components/Now.test.tsx`.
 */
const RENDER_TIMEOUT_MS = 15_000;

const PROJECTS = ['p-1', 'p-2'].map((id) => ({
  id,
  workspaceId: 'w',
  name: 'Project ${id}',
  slug: id,
  repoPath: null,
  detectorVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
}));

function stubFetch(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      // The cockpit has its own shape; everything else the page reads is a list.
      const body = url.includes('/api/v1/cockpit')
        ? JSON.stringify(cockpitFixture())
        : url.endsWith('/api/v1/projects')
          ? JSON.stringify({ projects: PROJECTS })
          : '[]';
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    'is where / lands, and asks for the cockpit, the runs, the portfolio and the deliveries',
    async () => {
      const asked = stubFetch();
      window.scrollTo = () => undefined;
      render(<MemoryRouter initialEntries={['/']} />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), {
        timeout: RENDER_TIMEOUT_MS,
      });
      await waitFor(
        () => {
          expect(asked.some((url) => url.includes('/api/v1/cockpit?window=7d'))).toBe(true);
          expect(asked.some((url) => url.includes('/runs'))).toBe(true);
          expect(asked.some((url) => url.includes('portfolio'))).toBe(true);
          expect(asked.some((url) => url.includes('deliveries'))).toBe(true);
        },
        { timeout: RENDER_TIMEOUT_MS },
      );
    },
    RENDER_TIMEOUT_MS * 2,
  );
  it(
    'asks about the project the address names, and follows the choice in the address',
    async () => {
      const asked = stubFetch();
      window.scrollTo = () => undefined;
      render(<MemoryRouter initialEntries={['/dashboard/now?project=p-1']} />);
      await waitFor(() => expect(asked.some((url) => url.includes('projectId=p-1'))).toBe(true), {
        timeout: RENDER_TIMEOUT_MS,
      });
      const select = await screen.findByLabelText('Project');
      expect(select).toHaveValue('p-1');
      await userEvent.setup().selectOptions(select, 'p-2');
      await waitFor(() => expect(asked.some((url) => url.includes('projectId=p-2'))).toBe(true), {
        timeout: RENDER_TIMEOUT_MS,
      });
      await userEvent.setup().selectOptions(await screen.findByLabelText('Project'), '');
      await waitFor(() => expect(screen.getByLabelText('Project')).toHaveValue(''), {
        timeout: RENDER_TIMEOUT_MS,
      });
    },
    RENDER_TIMEOUT_MS * 2,
  );
});
