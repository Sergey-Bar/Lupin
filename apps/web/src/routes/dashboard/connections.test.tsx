import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../../router.js';

/**
 * The Connections routes, mounted by the real router with their own clients, so each tab's
 * route component is exercised rather than declared.
 */
beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith('/api/v1/auth/whoami'))
        return reply({ actor: 'anonymous', role: 'admin', mode: 'open' });
      if (url.endsWith('/api/v1/projects')) return reply({ projects: [] });
      if (url.includes('/api/v1/github/repos')) return reply({ items: [] });
      if (url.includes('/api/v1/notification-channels')) return reply({ channels: [] });
      if (url.includes('/api/v1/report-subscriptions')) return reply({ subscriptions: [] });
      if (url.includes('/api/v1/report-deliveries')) return reply({ deliveries: [] });
      if (url.includes('/api/v1/report-preview'))
        return reply({ status: 'good', text: 'Weekly quality report' });
      return reply({});
    }),
  );
}

describe('the connections routes', () => {
  it.each([
    ['/dashboard/connections', 'connections-repositories'],
    ['/dashboard/connections/chat', 'notifications-page'],
    ['/dashboard/connections/ci', 'connections-ci'],
  ])('opens %s', async (path, testId) => {
    stubApi();
    render(<MemoryRouter initialEntries={[path]} />);
    expect(await screen.findByTestId(testId, {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens the GitHub tab on the repositories surface', async () => {
    stubApi();
    render(<MemoryRouter initialEntries={['/dashboard/connections/github']} />);
    await waitFor(
      () =>
        expect(screen.getByRole('navigation', { name: 'Connections pages' })).toBeInTheDocument(),
      { timeout: 10_000 },
    );
  });

  it('moves to the next category with one wheel step on the page', async () => {
    stubApi();
    render(<MemoryRouter initialEntries={['/dashboard/connections/ci']} />);
    await screen.findByTestId('connections-ci', {}, { timeout: 10_000 });
    fireEvent.wheel(screen.getByRole('main'), { deltaY: 200 });
    // Connections sits before Settings in the rail.
    await waitFor(
      () => expect(screen.getByTestId('settings-appearance-page')).toBeInTheDocument(),
      { timeout: 10_000 },
    );
  });
});
