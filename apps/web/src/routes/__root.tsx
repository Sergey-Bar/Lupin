import React from 'react';
import { Outlet, createRootRoute, redirect, useRouterState } from '@tanstack/react-router';
import { BottomTabBar, NavBar, SectionTabs } from '../components/NavBar.js';
import { SideNav } from '../components/SideNav.js';
import { SkipLink } from '../components/SkipLink.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import { GlobalCommandPalette } from '../components/GlobalCommandPalette.js';
import { CopilotProvider } from '../components/CopilotPanel.js';
import { ToastProvider } from '../components/Toasts.js';
import { Shortcuts } from '../components/Shortcuts.js';
import { PreferencesProvider } from '../theme/preferences.js';
import { createHealthClient } from '../lib/health-client.js';
import { PageContent } from '../components/PageContent.js';
import { documentTitleFor } from '../lib/document-title.js';

export const Route = createRootRoute({
  /**
   * `/` has no page; the command center is what a reader wants.
   *
   * Decided here, in `beforeLoad`, rather than by a rendered `<Navigate>` on a
   * child route declared with `path: '/'`. That declaration made `/` match the
   * child *and* the root, so every navigation re-ran matching, the rendered
   * redirect re-rendered, and matching ran again — until React threw at fifty
   * nested updates. `router.test.tsx` failed on a `waitFor` that reported a
   * timeout, so the loop underneath it was invisible; the same test was observed
   * at 1.5 s and then 15 s on consecutive runs of an unchanged tree.
   *
   * A redirect thrown from `beforeLoad` is a navigation decision rather than a
   * render, so it happens once and cannot re-trigger itself. It also runs before
   * the root component mounts, so `/` never paints a redirect at all.
   */
  beforeLoad: ({ location }) => {
    if (location.pathname === '/') throw redirect({ to: '/dashboard/now' });
  },
  component: RootComponent,
});

function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const health = React.useMemo(() => createHealthClient(), []);
  React.useEffect(() => {
    document.title = documentTitleFor(pathname);
  }, [pathname]);
  /*
   * **The viewport is the page.** `h-dvh` and `overflow-hidden` on the frame, and each
   * screen is laid out into what is left — `PageFrame` fills it and panels page their
   * lists — so a screen is composed to fit rather than scrolled through. `main` keeps
   * `overflow-y-auto` as a floor rather than a feature: below the `lg` breakpoint the
   * panels stack and reflow is what WCAG 1.4.10 requires, and clipping content that did
   * not fit would hide it rather than show it.
   *
   * The frame is `relative` on purpose. `sr-only` text is `position: absolute` with no offsets, and
   * an absolute box is clipped only by an ancestor that is its containing block. Without
   * `relative` here the initial containing block was, so screen-reader text sitting low in a long
   * page stretched the *document* past the viewport (1054px on `/dashboard`) while every visible
   * thing fit, and `overflow-hidden` on this frame could not stop it.
   */
  return (
    <ThemeProvider>
      <PreferencesProvider>
        <ToastProvider>
          <CopilotProvider>
            <div className="relative flex h-dvh overflow-hidden bg-surface-sunken text-fg">
              <SkipLink />
              {/* From `lg` up the sidebar is the chrome: every section and tab, fixed beside the page. */}
              <SideNav />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <NavBar />
                <main
                  id="main"
                  tabIndex={-1}
                  data-focus-column
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 outline-none sm:px-6 sm:py-6"
                >
                  {/*
                   * Secondary chrome: focus mode hides it (index.css). The attribute is on the
                   * navs themselves, not on a wrapper here — a wrapper rendered on a page with
                   * no tab row was an empty first child of <main>.
                   */}
                  <SectionTabs />
                  <PageContent health={health} pathname={pathname}>
                    <Outlet />
                  </PageContent>
                </main>
                <BottomTabBar />
              </div>
            </div>
            <GlobalCommandPalette />
            <Shortcuts />
          </CopilotProvider>
        </ToastProvider>
      </PreferencesProvider>
    </ThemeProvider>
  );
}
