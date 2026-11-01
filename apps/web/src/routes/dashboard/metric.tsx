import React from 'react';
import { createRoute } from '@tanstack/react-router';
import type { CockpitWindow } from '@lupin/shared-contracts';
import { Route as dashboardRoute } from '../dashboard.js';
import { MetricDetailPage, type MetricSources } from '../../components/MetricDetail.js';
import { createCockpitClient } from '../../lib/cockpit-client.js';

/**
 * One metric of the cockpit, a level down. The window the person was looking at travels in the
 * address (`?window=release`), so a link from the cockpit and a link shared in a message open
 * the same comparison.
 */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/metric/$metricId',
  validateSearch: (search: Record<string, unknown>): { window: CockpitWindow } => ({
    window: search['window'] === 'release' ? 'release' : '7d',
  }),
  component: function MetricRoute() {
    const { metricId } = Route.useParams();
    const { window } = Route.useSearch();
    const sources = React.useMemo<MetricSources>(() => {
      const client = createCockpitClient();
      return { cockpit: (query, signal) => client.getCockpit(query, signal) };
    }, []);
    return <MetricDetailPage metricId={metricId} initialWindow={window} sources={sources} />;
  },
});
