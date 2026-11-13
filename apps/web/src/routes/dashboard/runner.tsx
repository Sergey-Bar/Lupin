import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
import { defaultApiClient } from '../../lib/api.js';
import { createQaClient } from '../../lib/qa-client.js';

// The page loads when the route is first opened: no measured route draws it, and the first
// bundle is what the rendering budget times (see `components/lazy-page.tsx`).
const RunnerPage = lazyPage(() => import('./runner-page.js'), 'RunnerPage');

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/runner',
  component: () => <RunnerPage qa={createQaClient()} api={defaultApiClient} />,
});
