import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createAiCodeClient } from '../../lib/ai-code-client.js';
import { createDeliveryClient } from '../../lib/delivery-client.js';
// Static on purpose: the sign-in gate and `ProjectPage` import `Access.js` (and through it
// `Pairing.js`), so both are in the first bundle whatever this file does.
import { AccessGate, AccessPage } from '../../components/Access.js';
import { createAdminClient } from '../../lib/admin-client.js';
import { PairPage } from '../../components/Pairing.js';

// Loaded when the route is first opened; see `components/lazy-page.tsx`.
const Portfolio = lazyPage(() => import('../../components/Portfolio.js'), 'Portfolio');
const BriefingPage = lazyPage(() => import('../../components/Briefing.js'), 'BriefingPage');
const RepoHealth = lazyPage(() => import('../../components/RepoHealth.js'), 'RepoHealth');
const DeploymentPage = lazyPage(() => import('../../components/Deployment.js'), 'DeploymentPage');
const AuditPage = lazyPage(() => import('../../components/People.js'), 'AuditPage');
const MembersPage = lazyPage(() => import('../../components/People.js'), 'MembersPage');

/** The landing page: every repository's grade, worst first. */
export const PortfolioRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/portfolio',
  component: () => {
    const health = createHealthClient();
    return (
      <AccessGate health={health}>
        {() => (
          <Portfolio
            health={health}
            delivery={createDeliveryClient()}
            aiCode={createAiCodeClient()}
          />
        )}
      </AccessGate>
    );
  },
});

/** What happened over the window, for the portfolio or, with `?project=`, one repository. */
export const BriefingRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/briefing',
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search['project'] === 'string' && search['project'] !== ''
      ? { project: search['project'].slice(0, 100) }
      : {},
  component: () => {
    const { project } = BriefingRoute.useSearch();
    const health = React.useMemo(() => createHealthClient(), []);
    return (
      <AccessGate health={health}>
        {() => <BriefingPage health={health} projectId={project} />}
      </AccessGate>
    );
  },
});

/** One repository's grade, its limiter, the seven dimensions and the findings behind them. */
export const RepoHealthRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/repo/$projectId',
  component: () => {
    const { projectId } = RepoHealthRoute.useParams();
    const health = createHealthClient();
    return (
      <AccessGate health={health}>
        {() => <RepoHealth health={health} projectId={projectId} />}
      </AccessGate>
    );
  },
});

/** Access tokens and devices: issue, pair, list, revoke. */
export const AccessRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/access',
  component: () => <AccessPage health={createHealthClient()} />,
});

/** The people who signed in with single sign-on, and their roles here. An admin's page. */
export const MembersRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/members',
  component: () => <MembersPage health={createHealthClient()} admin={createAdminClient()} />,
});

/** The audit trail, whether its chain is intact, and its exports. An admin's page. */
export const AuditRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/audit',
  component: () => <AuditPage health={createHealthClient()} admin={createAdminClient()} />,
});

/** What this install is for (its deployment profile), who it lets in, and how to change it. */
export const DeploymentRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/deployment',
  component: () => <DeploymentPage health={createHealthClient()} admin={createAdminClient()} />,
});

/** Where a pairing QR code lands. Spends the code, then opens the dashboard as that device. */
export const PairRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/pair',
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search['code'] === 'string' || typeof search['code'] === 'number'
      ? { code: String(search['code']).replace(/\D/gu, '').slice(0, 6) }
      : {},
  component: () => {
    const { code } = PairRoute.useSearch();
    return (
      <PairPage
        health={createHealthClient()}
        initialCode={code ?? ''}
        onPaired={() => window.location.assign('/')}
      />
    );
  },
});
