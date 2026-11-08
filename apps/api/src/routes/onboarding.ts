import { Hono } from 'hono';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import {
  dismissOnboardingStep,
  readOnboarding,
  resetOnboarding,
  type OnboardingOptions,
} from '../services/onboarding-service.js';

export interface OnboardingRouteOptions extends OnboardingOptions {
  access: CallerResolver;
}

/**
 * The setup checklist. Everyone signed in may read it — a viewer is told who can finish each
 * step — and only an admin may skip a step, dismiss the card, or start setup over.
 */
export function createOnboardingRoutes(options: OnboardingRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);
  const admin = requireRole('admin', options.access);

  app.get('/api/v1/onboarding', viewer, async (context) =>
    context.json(await readOnboarding(options)),
  );

  app.post('/api/v1/onboarding/:step/dismiss', admin, async (context) => {
    const step = context.req.param('step');
    const actor = (await callerOf(context, options.access)).actor;
    await dismissOnboardingStep(options, step, actor);
    await audit(options, {
      actor,
      action: 'onboarding.dismiss',
      resourceType: 'onboarding_step',
      resourceId: step,
    });
    return context.json(await readOnboarding(options));
  });

  app.post('/api/v1/onboarding/reset', admin, async (context) => {
    await resetOnboarding(options);
    await audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action: 'onboarding.reset',
      resourceType: 'onboarding_step',
      resourceId: 'all',
    });
    return context.json(await readOnboarding(options));
  });

  return app;
}
