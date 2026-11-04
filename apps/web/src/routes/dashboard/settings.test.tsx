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

function stubAdminApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith('/api/v1/auth/whoami'))
        return reply({ actor: 'anonymous', role: 'admin', mode: 'open' });
      if (url.includes('/api/v1/notification-channels')) return reply({ channels: [] });
      if (url.includes('/api/v1/report-subscriptions')) return reply({ subscriptions: [] });
      if (url.includes('/api/v1/report-deliveries')) return reply({ deliveries: [] });
      if (url.includes('/api/v1/report-preview'))
        return reply({ status: 'good', text: '🟢 Weekly quality report' });
      if (url.includes('/api/v1/access-tokens')) return reply({ tokens: [] });
      if (url.includes('/api/v1/members')) return reply({ members: [] });
      if (url.includes('/api/v1/audit/verify'))
        return reply({ intact: true, breaks: [], head: null });
      if (url.includes('/api/v1/audit')) return reply({ events: [], next: null });
      if (url.includes('/api/v1/workspaces'))
        return reply({ current: 'w', workspaces: [], canCreate: false });
      if (url.includes('/api/v1/projects')) return reply([]);
      return reply({});
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
});
