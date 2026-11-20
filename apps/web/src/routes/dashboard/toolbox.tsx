import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
import { createQaClient } from '../../lib/qa-client.js';

// The page loads when the route is first opened: no measured route draws it, and the first
// bundle is what the rendering budget times (see `components/lazy-page.tsx`).
const ToolboxPage = lazyPage(() => import('./toolbox-page.js'), 'ToolboxPage');

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/toolbox',
  component: () => <ToolboxPage qa={createQaClient()} />,
});
