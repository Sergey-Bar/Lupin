import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { CockpitPage, type CockpitSources } from '../../components/Cockpit.js';
import { defaultApiClient } from '../../lib/api.js';
import { createCockpitClient } from '../../lib/cockpit-client.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';

/** The landing page: is the product better or worse than before, and what needs you. `/` lands here. */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/now',
  component: function NowRoute() {
    const navigate = useNavigate();
    const sources = React.useMemo<CockpitSources>(() => {
      const cockpit = createCockpitClient();
      const health = createHealthClient();
      const notifications = createNotificationsClient();
      return {
        cockpit: (query, signal) => cockpit.getCockpit(query, signal),
        attention: {
          runs: () => defaultApiClient.getRuns(),
          portfolio: () => health.getPortfolio(),
          deliveries: () => notifications.listDeliveries(),
        },
      };
    }, []);
    return <CockpitPage sources={sources} navigate={(to) => void navigate({ to })} />;
  },
});
