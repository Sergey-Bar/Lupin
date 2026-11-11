import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { CockpitPage, type CockpitSources } from '../../components/Cockpit.js';
import { defaultApiClient } from '../../lib/api.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';
import { createQaClient } from '../../lib/qa-client.js';
import { createGithubClient } from '../../lib/github-client.js';
import { homeProject, rememberHomeProject } from '../../lib/home-project.js';
import { putOffSetup, setupPutOff, shouldOpenSetup } from '../../lib/first-run.js';
import { createSettingsClient } from '../../lib/settings-client.js';

/**
 * A fresh install has nothing for Home to judge, so Home hands the reader to setup, once per
 * load. A failed read keeps Home: setup is an offer, never a wall.
 */
function useFirstRunRedirect(open: () => void): void {
  const opened = React.useRef(open);
  React.useEffect(() => {
    if (setupPutOff()) return undefined;
    let live = true;
    createSettingsClient()
      .getOnboarding()
      .then((onboarding) => {
        if (!live || !shouldOpenSetup(onboarding, setupPutOff())) return;
        // Once only: coming back from setup by any route is not a reason to send them again.
        putOffSetup();
        opened.current();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
}

/** The landing page: is the product better or worse than before, and what needs you. `/` lands here. */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/now',
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search['project'] === 'string' && search['project'] !== ''
      ? { project: search['project'].slice(0, 100) }
      : {},
  component: function NowRoute() {
    const navigate = useNavigate();
    const { project } = Route.useSearch();
    useFirstRunRedirect(() => void navigate({ to: '/dashboard/setup', replace: true }));
    const sources = React.useMemo<CockpitSources>(() => {
      const health = createHealthClient();
      const notifications = createNotificationsClient();
      const qa = createQaClient();
      const github = createGithubClient();
      return {
        projects: async () => (await qa.listProjects()).map(({ id, name }) => ({ id, name })),
        // The hero's verdict: the chosen project, else the first registered one.
        readiness: async (projectId) => {
          const id = projectId ?? (await qa.listProjects())[0]?.id;
          if (id === undefined) throw new Error('not found');
          return qa.getReadiness(id, 7);
        },
        // Triage: the failures of the last 14 days grouped by root cause, server-side.
        clusters: async (projectId) => (await qa.getInsights(14, projectId)).failureClusters,
        // Release: failed results per day. The trend is the workspace's, so it takes no project.
        trend: async () =>
          (await qa.getTrend(14)).buckets.map((bucket) => ({
            date: bucket.date,
            failed: bucket.failed,
          })),
        attention: {
          runs: () => defaultApiClient.getRuns(),
          portfolio: () => health.getPortfolio(),
          deliveries: () => notifications.listDeliveries(),
          retryRun: (runId, scope) => defaultApiClient.retryRun(runId, undefined, { scope }),
          pulls: async () => (await github.listPulls({ state: 'open', limit: 50 })).items,
        },
      };
    }, []);
    return (
      <CockpitPage
        sources={sources}
        navigate={(to) => void navigate({ to })}
        initialProjectId={homeProject(project)}
        onProjectChange={(next) => {
          rememberHomeProject(next);
          void navigate({
            to: '/dashboard/now',
            search: next === undefined ? {} : { project: next },
            replace: true,
          });
        }}
      />
    );
  },
});
