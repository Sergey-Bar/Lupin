import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { SettingsReports } from './settings.js';

/**
 * Scheduled reports at their older address. The root redirects it to Settings → Reports; the
 * route stays so a direct match still draws the same page, from the one definition.
 */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/reports',
  component: SettingsReports,
});
