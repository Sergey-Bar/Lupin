import { CommandPalette } from '@lupin/ui';
import { useCommandStore, useCommandActions } from '../hooks/useCommandActions.js';
import { useViewerRole } from '../hooks/useViewerRole.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { usePreferences } from '../theme/preferences.js';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { roleMeets, visibleRoutes, type TabAccess, type ViewerRole } from '../route-manifest.js';
import { useCopilot } from './CopilotPanel.js';

/**
 * The pages the palette offers `role`: visible, and only those the role may open, so a viewer
 * is never sent to a page the API refuses (ledger MNT-184).
 */
export function paletteRoutes(role: ViewerRole | null) {
  return visibleRoutes.filter((route) => roleMeets((route as { access?: TabAccess }).access, role));
}

export const QUESTIONS = [
  {
    id: 'ship',
    label: 'Can we ship? Release readiness',
    keywords: ['release', 'ready', 'readiness', 'ship', 'go', 'no-go', 'blocking'],
    // Home: the release verdict and what blocks it.
    to: '/dashboard/now',
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
  const copilot = useCopilot();
  const role = useViewerRole();

  // One entry per page the caller may open, read from the manifest, so a screen added to the
  // navigation is in the palette too rather than in one and not the other.
  const builtInActions = useMemo(
    () => [
      ...paletteRoutes(role).map((route) => ({
        id: `nav-${route.id}`,
        label: `Go to ${route.label}`,
        onSelect: () => void navigate({ to: route.path }),
      })),
      {
        id: 'theme-toggle',
        label: 'Toggle theme',
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
      // **No "Sign out" here.** Signing out is on the Access page, beside the sign-in it
      // ends, where the reader can see which credential this browser holds.
    ],
    [navigate, setTheme, theme, preferences, update, role],
  );

  useCommandActions(builtInActions);

  // Anything typed that is not a command can be asked; the answer opens in the side panel.
  return <CommandPalette actions={actions} {...(copilot === null ? {} : { onAsk: copilot.ask })} />;
}
