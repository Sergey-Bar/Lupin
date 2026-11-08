import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { lazyPage } from '../../components/lazy-page.js';
import { createHealthClient } from '../../lib/health-client.js';
import { createNotificationsClient } from '../../lib/notifications-client.js';
import { createQaClient } from '../../lib/qa-client.js';
import { createSettingsClient } from '../../lib/settings-client.js';

const SetupPage = lazyPage(() => import('../../components/SetupWizard.js'), 'SetupPage');

/** First-run setup. Reached from the cockpit's checklist and from an empty project screen. */
export const SetupRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/setup',
  component: function Setup() {
    const clients = React.useMemo(
      () => ({
        health: createHealthClient(),
        settings: createSettingsClient(),
        qa: createQaClient(),
        notifications: createNotificationsClient(),
      }),
      [],
    );
    return <SetupPage clients={clients} />;
  },
});
