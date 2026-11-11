import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
import { DeliveryArea } from '../../components/DeliveryArea.js';
import { projectSearch } from '../../components/ProjectPage.js';
import { createDeliveryClient } from '../../lib/delivery-client.js';
import { createGithubClient } from '../../lib/github-client.js';
import { createHealthClient } from '../../lib/health-client.js';

// Loaded when the route is first opened; see `components/lazy-page.tsx`.
const IssuesPage = lazyPage(() => import('../../components/GithubIssues.js'), 'IssuesPage');
const PullRequestsPage = lazyPage(
  () => import('../../components/GithubPulls.js'),
  'PullRequestsPage',
);
const ReposPage = lazyPage(() => import('../../components/GithubRepos.js'), 'ReposPage');
const RepoDetailPage = lazyPage(() => import('../../components/GithubRepos.js'), 'RepoDetailPage');
const PullRequestRiskPage = lazyPage(
  () => import('../../components/PullRequestRisk.js'),
  'PullRequestRiskPage',
);

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
    const listPulls = React.useCallback(
      () => github.listPulls({ state: 'open', limit: 50 }),
      [github],
    );
    return (
      <DeliveryArea
        listPulls={listPulls}
        navigate={(to) => window.location.assign(to)}
        details={<PullRequestsPage github={github} health={health} initialProjectId={project} />}
      />
    );
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

/** One pull request's change risk. A number that is not one is "no such pull request". */
export const PullRequestRiskRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/prs/$projectId/$number',
  component: () => {
    const { projectId, number } = PullRequestRiskRoute.useParams();
    const github = React.useMemo(() => createGithubClient(), []);
    const health = React.useMemo(() => createHealthClient(), []);
    const parsed = Number(number);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return (
        <p className="max-w-measure p-6 text-sm text-fg-muted">
          That is not a pull request number. Open one from the Pull requests list.
        </p>
      );
    }
    return (
      <PullRequestRiskPage projectId={projectId} number={parsed} github={github} shapes={health} />
    );
  },
});
