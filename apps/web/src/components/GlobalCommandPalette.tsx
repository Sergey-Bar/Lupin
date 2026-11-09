import { CommandPalette } from '@lupin/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { usePreferences } from '../theme/preferences.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { visibleRoutes } from '../route-manifest.js';

const QUESTIONS = [
  {
    id: 'ship',
    label: 'Can we ship? Release readiness',
    keywords: ['release', 'ready', 'readiness', 'ship', 'go', 'no-go', 'blocking'],
    to: '/dashboard',
  },
  {
    id: 'failing',
    label: 'What is failing right now?',
    keywords: ['fail', 'failed', 'failing', 'broken', 'red', 'main', 'branch'],
    to: '/dashboard/now',
  },
  {
    id: 'flaky',
    label: 'Which tests are flaky?',
    keywords: ['flaky', 'flake', 'unstable', 'flipping', 'quarantine'],
    to: '/dashboard/insights',
  },
  {
    id: 'slow',
    label: 'Which tests are slowest?',
    keywords: ['slow', 'slowest', 'duration', 'time', 'tests'],
    to: '/dashboard/insights',
  },
  {
    id: 'coverage',
    label: 'Where are the coverage gaps?',
    keywords: ['coverage', 'gaps', 'gap', 'untested', 'missing'],
    to: '/dashboard',
  },
] as const;

export function GlobalCommandPalette() {
  const actions = useCommandStore();
  const { theme, setTheme } = useTheme();
  const { preferences, update } = usePreferences();
  const navigate = useNavigate();

  // One entry per visible route, read from the manifest, so a screen added to the
  // navigation bar is in the palette too rather than in one and not the other.
  const builtInActions = useMemo(
    () => [
      ...visibleRoutes.map((route) => ({
        id: `nav-${route.id}`,
        label: `Go to ${route.label}`,
        onSelect: () => void navigate({ to: route.path }),
      })),
      {
        id: 'theme-toggle',
        label: 'Toggle Theme',
        onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'density-toggle',
        label: preferences.density === 'compact' ? 'Comfortable density' : 'Compact density',
        onSelect: () =>
          update({ density: preferences.density === 'compact' ? 'comfortable' : 'compact' }),
      },
      {
        id: 'motion-toggle',
        label: preferences.motion === 'reduced' ? 'Full motion' : 'Reduce motion',
        onSelect: () => update({ motion: preferences.motion === 'reduced' ? 'full' : 'reduced' }),
      },
      // **The questions a QA person asks**, each answered by the page that answers it. The
      // palette matches them by their words, so "is the release ready" finds "Can we ship?".
      ...QUESTIONS.map((question) => ({
        id: `ask-${question.id}`,
        label: question.label,
        keywords: question.keywords,
        onSelect: () => void navigate({ to: question.to }),
      })),
      // **No "Sign Out" action.** There is no session to end on an open install, and a
      // palette entry that navigated to a route which no longer exists would leave the
      // user on a dead link.
    ],
    [navigate, setTheme, theme, preferences, update],
  );

  useCommandActions(builtInActions);

  return <CommandPalette actions={actions} />;
}
