import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';
import { createQaClient } from '../../lib/qa-client.js';

// Loaded when the route is first opened; see `components/lazy-page.tsx`.
const NotificationsPage = lazyPage(
  () => import('../../components/Notifications.js'),
  'NotificationsPage',
);

/** Scheduled reports: channels, schedules, the preview and the delivery history. */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/reports',
  component: function ReportsRoute() {
    const client = React.useMemo(() => createNotificationsClient(), []);
    const projects = React.useMemo(() => {
      const qa = createQaClient();
      return async () => (await qa.listProjects()).map(({ id, name }) => ({ id, name }));
    }, []);
    return <NotificationsPage client={client} projects={projects} />;
  },
});
