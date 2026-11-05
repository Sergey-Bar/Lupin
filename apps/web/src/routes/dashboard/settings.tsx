import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
// Static: the sign-in gate already puts `Access.js` in the first bundle (see portfolio.tsx).
import { AccessPage } from '../../components/Access.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';
import { createQaClient } from '../../lib/qa-client.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createAdminClient } from '../../lib/admin-client.js';

// Loaded when the route is first opened; see `components/lazy-page.tsx`.
const SettingsAppearancePage = lazyPage(
  () => import('../../components/Settings.js'),
  'SettingsAppearancePage',
);
const NotificationsPage = lazyPage(
  () => import('../../components/Notifications.js'),
  'NotificationsPage',
);
const AuditPage = lazyPage(() => import('../../components/People.js'), 'AuditPage');
const MembersPage = lazyPage(() => import('../../components/People.js'), 'MembersPage');
const DeploymentPage = lazyPage(() => import('../../components/Deployment.js'), 'DeploymentPage');

/**
 * The Settings section's pages, each a tab of `/dashboard/settings`.
 *
 * Appearance is the landing (`/dashboard/settings`); the other tabs reuse the admin and
 * report surfaces under `settings/*`, so the old `/dashboard/access` etc. paths keep
 * working and a reader also finds them in one place. The tab row itself is drawn by
 * the sidebar (`NavBar`) from the manifest — these routes only supply the pages.
 */
export const SettingsAppearanceRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings',
  component: () => <SettingsAppearancePage />,
});

/**
 * The remaining Settings tabs are registered here so the tab row never links to a dead
 * path. Reports is the live reports surface; the admin surfaces are wired in Task 5 and
 * until then render the Appearance page so the section stays navigable.
 */
export const SettingsReportsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/reports',
  component: function SettingsReports() {
    const client = React.useMemo(() => createNotificationsClient(), []);
    const projects = React.useMemo(() => {
      const qa = createQaClient();
      return async () => (await qa.listProjects()).map(({ id, name }) => ({ id, name }));
    }, []);
    return <NotificationsPage client={client} projects={projects} />;
  },
});

export const SettingsAccessRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/access',
  component: () => <AccessPage health={createHealthClient()} />,
});

export const SettingsMembersRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/members',
  component: () => <MembersPage health={createHealthClient()} admin={createAdminClient()} />,
});

export const SettingsAuditRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/audit',
  component: () => <AuditPage health={createHealthClient()} admin={createAdminClient()} />,
});

export const SettingsDeploymentRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/deployment',
  component: () => <DeploymentPage health={createHealthClient()} admin={createAdminClient()} />,
});
