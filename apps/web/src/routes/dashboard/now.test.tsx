import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from '../../router.js';
import { cockpitFixture, makeRun } from '../../test-utils.js';
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
  it('hands a fresh install to full-screen setup, once', async () => {
    localStorage.clear();
    const fresh = {
      steps: [
        { id: 'workspace', title: 'W', who: 'admin', href: '/', state: 'done' },
        { id: 'repository', title: 'R', who: 'operator', href: '/', state: 'todo' },
      ],
      done: 1,
      total: 6,
      dismissed: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.endsWith('/api/v1/onboarding')
          ? JSON.stringify(fresh)
          : url.endsWith('/api/v1/projects')
            ? JSON.stringify({ projects: [] })
            : '[]';
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    window.scrollTo = () => undefined;
    render(<MemoryRouter initialEntries={['/dashboard/now']} />);
    await waitFor(() => expect(screen.getByTestId('setup-page')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
    expect(localStorage.getItem('lupin-setup-later')).toBe('1');
  });

  it('is mounted at /dashboard/now', () => {
    expect(Route.fullPath).toBe('/dashboard/now');
  });

  it(
    'is where / lands, and asks for the runs, the portfolio and the deliveries, not the numbers',
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
      // The product's numbers moved to Health: Home does not read them.
      expect(asked.some((url) => url.includes('/api/v1/cockpit'))).toBe(false);
    },
    RENDER_TIMEOUT_MS * 2,
  );
  it(
    'asks about the project the address names, and follows the choice in the address',
    async () => {
      const asked = stubFetch();
      window.scrollTo = () => undefined;
      render(<MemoryRouter initialEntries={['/dashboard/now?project=p-1']} />);
      await waitFor(
        () => expect(asked.some((url) => url.includes('/projects/p-1/readiness'))).toBe(true),
        {
          timeout: RENDER_TIMEOUT_MS,
        },
      );
      const select = await screen.findByLabelText('Project');
      expect(select).toHaveValue('p-1');
      await userEvent.setup().selectOptions(select, 'p-2');
      await waitFor(
        () => expect(asked.some((url) => url.includes('/projects/p-2/readiness'))).toBe(true),
        {
          timeout: RENDER_TIMEOUT_MS,
        },
      );
      await userEvent.setup().selectOptions(await screen.findByLabelText('Project'), '');
      await waitFor(() => expect(screen.getByLabelText('Project')).toHaveValue(''), {
        timeout: RENDER_TIMEOUT_MS,
      });
    },
    RENDER_TIMEOUT_MS * 2,
  );
  it(
    'retries just the failed tests of a red run with one click',
    async () => {
      const failing = makeRun({
        id: 'red-run',
        branch: 'main',
        phase: 'complete',
        outcome: 'failed',
        tests: [
          {
            id: 't-red',
            title: 'pays',
            status: 'failed',
            attempts: [],
            artifactIds: [],
            metadata: {},
          },
        ],
      });
      const posted: { url: string; body: unknown }[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (init?.method === 'POST') posted.push({ url, body: init.body });
          const body = url.includes('/api/v1/cockpit')
            ? JSON.stringify(cockpitFixture())
            : url.endsWith('/retry')
              ? JSON.stringify(makeRun({ id: 'again', retryOfRunId: 'red-run', attempt: 2 }))
              : url.includes('/api/v1/runs')
                ? JSON.stringify([failing])
                : url.endsWith('/api/v1/projects')
                  ? JSON.stringify({ projects: PROJECTS })
                  : '[]';
          return new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }),
      );
      window.scrollTo = () => undefined;
      render(<MemoryRouter initialEntries={['/dashboard/now']} />);
      const retry = await screen.findByRole(
        'button',
        { name: 'Retry the failed test' },
        { timeout: RENDER_TIMEOUT_MS },
      );
      await userEvent.setup().click(retry);
      await waitFor(() =>
        expect(posted).toContainEqual({
          url: '/api/v1/runs/red-run/retry',
          body: '{"scope":"failed"}',
        }),
      );
    },
    RENDER_TIMEOUT_MS * 2,
  );
});
