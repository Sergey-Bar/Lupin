import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
import { createQaClient } from '../../lib/qa-client.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createGithubClient } from '../../lib/github-client.js';
import { createDeliveryClient } from '../../lib/delivery-client.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';

const RepositoriesPage = lazyPage(
  () => import('../../components/Connections.js'),
  'RepositoriesPage',
);
const CiPage = lazyPage(() => import('../../components/Connections.js'), 'CiPage');
const ReposPage = lazyPage(() => import('../../components/GithubRepos.js'), 'ReposPage');
const NotificationsPage = lazyPage(
  () => import('../../components/Notifications.js'),
  'NotificationsPage',
);

/** Connections: repositories, GitHub, chat apps and CI, one tab each. */
export const ConnectionsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/connections',
  component: function ConnectionsRepositories() {
    const qa = React.useMemo(() => createQaClient(), []);
    const health = React.useMemo(() => createHealthClient(), []);
    return <RepositoriesPage qa={qa} health={health} />;
  },
});

export const ConnectionsGithubRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/connections/github',
  component: function ConnectionsGithub() {
    const github = React.useMemo(() => createGithubClient(), []);
    const delivery = React.useMemo(() => createDeliveryClient(), []);
    const health = React.useMemo(() => createHealthClient(), []);
    return <ReposPage github={github} delivery={delivery} health={health} />;
  },
});

export const ConnectionsChatRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/connections/chat',
  component: function ConnectionsChat() {
    const client = React.useMemo(() => createNotificationsClient(), []);
    const projects = React.useMemo(() => {
      const qa = createQaClient();
      return async () => (await qa.listProjects()).map(({ id, name }) => ({ id, name }));
    }, []);
    return <NotificationsPage client={client} projects={projects} />;
  },
});

export const ConnectionsCiRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/connections/ci',
  component: () => <CiPage />,
});
