import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../../router.js';

/**
 * The Settings routes, mounted by the real router with their own clients, so the route
 * component factories — and the admin surfaces they compose — are exercised rather than
 * declared. `fetch` is stubbed admin so the role-gated tabs and admin pages render.
 */
beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What the stubbed API answers, by path; the first entry whose test matches wins. */
const ANSWERS: ReadonlyArray<readonly [(url: string) => boolean, unknown]> = [
  [
    (url) => url.endsWith('/api/v1/auth/whoami'),
    { actor: 'anonymous', role: 'admin', mode: 'open' },
  ],
  [(url) => url.includes('/api/v1/notification-channels'), { channels: [] }],
  [(url) => url.includes('/api/v1/report-subscriptions'), { subscriptions: [] }],
  [(url) => url.includes('/api/v1/report-deliveries'), { deliveries: [] }],
  [
    (url) => url.includes('/api/v1/report-preview'),
    { status: 'good', text: '🟢 Weekly quality report' },
  ],
  [(url) => url.includes('/api/v1/access-tokens'), { tokens: [] }],
  [(url) => url.includes('/api/v1/members'), { members: [] }],
  [(url) => url.includes('/api/v1/audit/verify'), { intact: true, breaks: [], head: null }],
  [(url) => url.includes('/api/v1/audit'), { events: [], next: null }],
  [(url) => url.includes('/api/v1/workspaces'), { current: 'w', workspaces: [], canCreate: false }],
  [(url) => url.includes('/api/v1/settings'), { settings: [] }],
  [(url) => url.includes('/api/v1/onboarding'), { steps: [], done: 1, total: 6, dismissed: false }],
  [(url) => url.includes('/api/v1/dashboard/quality-gates'), []],
  [(url) => url.endsWith('/api/v1/projects'), { projects: [] }],
  [(url) => url.includes('/api/v1/projects'), []],
];

function stubAdminApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = ANSWERS.find(([matches]) => matches(url))?.[1] ?? {};
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

describe('the settings routes', () => {
  it('opens Appearance, the landing, with its controls', async () => {
    stubAdminApi();
    render(<MemoryRouter initialEntries={['/dashboard/settings']} />);
    expect(
      await screen.findByTestId('settings-appearance-page', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  });

  it('opens Reports under settings, reusing the notifications surface', async () => {
    stubAdminApi();
    render(<MemoryRouter initialEntries={['/dashboard/settings/reports']} />);
    expect(
      await screen.findByTestId('notifications-page', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('opens Access under settings', async () => {
    stubAdminApi();
    render(<MemoryRouter initialEntries={['/dashboard/settings/access']} />);
    expect(await screen.findByTestId('access-page', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens Members under settings', async () => {
    stubAdminApi();
    render(<MemoryRouter initialEntries={['/dashboard/settings/members']} />);
    expect(await screen.findByTestId('members-page', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens Audit under settings', async () => {
    stubAdminApi();
    render(<MemoryRouter initialEntries={['/dashboard/settings/audit']} />);
    expect(await screen.findByTestId('audit-page', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens Deployment under settings', async () => {
    stubAdminApi();
    render(<MemoryRouter initialEntries={['/dashboard/settings/deployment']} />);
    expect(
      await screen.findByTestId('deployment-page', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });
  it.each([
    ['/dashboard/settings/projects', 'settings-projects'],
    ['/dashboard/settings/quality-gates', 'settings-quality-gates'],
    ['/dashboard/settings/ai', 'settings-ai'],
    ['/dashboard/settings/integrations', 'settings-integrations'],
    ['/dashboard/settings/identity', 'settings-identity'],
    ['/dashboard/settings/sessions', 'settings-sessions-retention'],
    ['/dashboard/setup', 'setup-page'],
  ])('opens %s', async (path, testId) => {
    stubAdminApi();
    render(<MemoryRouter initialEntries={[path]} />);
    expect(await screen.findByTestId(testId, {}, { timeout: 10_000 })).toBeInTheDocument();
  });
});
