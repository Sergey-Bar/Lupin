import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { CockpitPage, type CockpitSources } from '../../components/Cockpit.js';
import { defaultApiClient } from '../../lib/api.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';
import { createQaClient } from '../../lib/qa-client.js';
import { createGithubClient } from '../../lib/github-client.js';

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
        initialProjectId={project}
        onProjectChange={(next) =>
          void navigate({
            to: '/dashboard/now',
            search: next === undefined ? {} : { project: next },
            replace: true,
          })
        }
      />
    );
  },
});
