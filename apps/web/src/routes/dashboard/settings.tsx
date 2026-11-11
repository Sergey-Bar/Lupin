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
import { createSettingsClient } from '../../lib/settings-client.js';

const pages = () => import('../../components/SettingsPages.js');
const ProjectsSettingsPage = lazyPage(pages, 'ProjectsSettingsPage');
const QualityGatesSettingsPage = lazyPage(pages, 'QualityGatesSettingsPage');
const AiSettingsPage = lazyPage(pages, 'AiSettingsPage');
const IntegrationsSettingsPage = lazyPage(pages, 'IntegrationsSettingsPage');
const SessionsSettingsPage = lazyPage(pages, 'SessionsSettingsPage');
const IdentitySettingsPage = lazyPage(
  () => import('../../components/IdentitySettings.js'),
  'IdentitySettingsPage',
);

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
 * working and a reader also finds them in one place. The sidebar's Settings mode lists them
 * from the manifest — these routes only supply the pages.
 */
export const SettingsAppearanceRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings',
  component: function SettingsLanding() {
    // The setup line, while setup is unfinished: it left Home so Home is one decision.
    const setup = React.useMemo(() => {
      const settings = createSettingsClient();
      const health = createHealthClient();
      return {
        load: () => settings.getOnboarding(),
        dismiss: () => settings.dismissStep('checklist'),
        role: async () => (await health.whoami()).role,
      };
    }, []);
    return <SettingsAppearancePage setup={setup} />;
  },
});

/**
 * The remaining Settings tabs are registered here so the tab row never links to a dead
 * path: Reports, Members, Access, Audit, Deployment and the installation pages, each the same
 * page the older top-level path opens.
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

/** One client per page load: the settings screens share no state but the API's. */
const settingsClient = () => createSettingsClient();

export const SettingsProjectsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/projects',
  component: function SettingsProjects() {
    const clients = React.useMemo(
      () => ({ health: createHealthClient(), client: settingsClient(), qa: createQaClient() }),
      [],
    );
    return <ProjectsSettingsPage {...clients} />;
  },
});

export const SettingsQualityGatesRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/quality-gates',
  component: function SettingsQualityGates() {
    const clients = React.useMemo(
      () => ({ health: createHealthClient(), client: settingsClient() }),
      [],
    );
    return <QualityGatesSettingsPage {...clients} />;
  },
});

export const SettingsAiRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/ai',
  component: function SettingsAi() {
    const clients = React.useMemo(
      () => ({ health: createHealthClient(), client: settingsClient() }),
      [],
    );
    return <AiSettingsPage {...clients} />;
  },
});

export const SettingsIntegrationsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/integrations',
  component: function SettingsIntegrations() {
    const clients = React.useMemo(
      () => ({ health: createHealthClient(), client: settingsClient() }),
      [],
    );
    return <IntegrationsSettingsPage {...clients} />;
  },
});

export const SettingsIdentityRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/identity',
  component: function SettingsIdentity() {
    const clients = React.useMemo(
      () => ({ health: createHealthClient(), client: settingsClient() }),
      [],
    );
    return <IdentitySettingsPage {...clients} />;
  },
});

export const SettingsSessionsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings/sessions',
  component: function SettingsSessions() {
    const clients = React.useMemo(
      () => ({ health: createHealthClient(), client: settingsClient() }),
      [],
    );
    return <SessionsSettingsPage {...clients} />;
  },
});
