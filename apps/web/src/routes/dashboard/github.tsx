import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { IssuesPage } from '../../components/GithubIssues.js';
import { PullRequestsPage } from '../../components/GithubPulls.js';
import { RepoDetailPage, ReposPage } from '../../components/GithubRepos.js';
import { projectSearch } from '../../components/ProjectPage.js';
import { createDeliveryClient } from '../../lib/delivery-client.js';
import { createGithubClient } from '../../lib/github-client.js';
import { createHealthClient } from '../../lib/health-client.js';

/**
 * The GitHub section: pull requests and issues across every repository, the repositories with
 * their health, and one repository in detail. `?project=` narrows a list to one repository, so
 * a link from the repository page opens the same list already filtered.
 */
export const PrsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/prs',
  validateSearch: projectSearch,
  component: () => {
    const { project } = PrsRoute.useSearch();
    const github = React.useMemo(() => createGithubClient(), []);
    const health = React.useMemo(() => createHealthClient(), []);
    return <PullRequestsPage github={github} health={health} initialProjectId={project} />;
  },
});

export const IssuesRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/issues',
  validateSearch: projectSearch,
  component: () => {
    const { project } = IssuesRoute.useSearch();
    const github = React.useMemo(() => createGithubClient(), []);
    const health = React.useMemo(() => createHealthClient(), []);
    return <IssuesPage github={github} health={health} initialProjectId={project} />;
  },
});

export const ReposRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/repos',
  component: () => {
    const github = React.useMemo(() => createGithubClient(), []);
    const delivery = React.useMemo(() => createDeliveryClient(), []);
    const health = React.useMemo(() => createHealthClient(), []);
    return <ReposPage github={github} delivery={delivery} health={health} />;
  },
});

export const RepoDetailRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/repos/$projectId',
  component: () => {
    const { projectId } = RepoDetailRoute.useParams();
    const github = React.useMemo(() => createGithubClient(), []);
    const health = React.useMemo(() => createHealthClient(), []);
    return <RepoDetailPage projectId={projectId} github={github} health={health} />;
  },
});
