import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { inAppHref, useInAppLinks } from './InAppLinks.js';

/**
 * Links to pages of this app navigate in the app (ledger MNT-186). About forty internal links,
 * `ButtonLink`s among them, were plain anchors: following one reloaded the whole app, dropped
 * its state and re-ran every request. One handler at the root now routes them, so a new link
 * cannot forget to.
 */
function Root() {
  useInAppLinks();
  return <Outlet />;
}

function app(initial: string, links: React.ReactNode) {
  const root = createRootRoute({ component: Root });
  const from = createRoute({ getParentRoute: () => root, path: '/from', component: () => links });
  const to = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/runs',
    component: () => <p>Arrived</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([from, to]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const click = (element: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  fireEvent(element, event);
  return event;
};

describe('in-app links', () => {
  it('routes a plain link to a page, query kept, without a page load', async () => {
    const router = app(
      '/from',
      <a href="/dashboard/runs?x=1">
        <span>Runs</span>
      </a>,
    );
    const event = click(await screen.findByText('Runs'));
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByText('Arrived')).toBeInTheDocument();
    expect(router.state.location.href).toBe('/dashboard/runs?x=1');
  });

  it('leaves new tabs, downloads, the API, other origins and fragments to the browser', async () => {
    app(
      '/from',
      <>
        <a href="/dashboard/runs">tab</a>
        <a href="/dashboard/runs" target="_blank" rel="noreferrer">
          blank
        </a>
        <a href="/api/v1/projects/p/cockpit/report.html">api</a>
        <a href="/dashboard/runs" download>
          download
        </a>
        <a href="https://github.com/acme/shop">github</a>
        <a href="#main">skip</a>
      </>,
    );
    expect(click(await screen.findByText('tab'), { ctrlKey: true }).defaultPrevented).toBe(false);
    for (const name of ['blank', 'api', 'download', 'github', 'skip']) {
      expect(click(screen.getByText(name)).defaultPrevented, name).toBe(false);
    }
  });

  it('decides from the address alone', () => {
    const origin = 'https://lupin.local';
    expect(inAppHref('https://lupin.local/dashboard/now?project=p', origin)).toBe(
      '/dashboard/now?project=p',
    );
    expect(inAppHref('https://lupin.local/api/v1/audit/export', origin)).toBeNull();
    expect(inAppHref('https://other.example/dashboard/now', origin)).toBeNull();
    expect(inAppHref('https://lupin.local/dashboard/now#tests', origin)).toBe(
      '/dashboard/now#tests',
    );
    // An address the URL parser refuses is the browser's to deal with.
    expect(inAppHref('http://[::1', origin)).toBeNull();
  });
});
