import { and, count, eq } from 'drizzle-orm';
import {
  notificationChannels,
  onboardingProgress,
  projects,
  runs,
  workspaceMembers,
} from '@lupin/db';
import {
  ONBOARDING_STEPS,
  type Onboarding,
  type OnboardingStep,
  type OnboardingStepId,
} from '@lupin/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * The "Get set up" checklist, derived from what exists rather than from what someone ticked.
 *
 * A step is `done` when the workspace actually has the thing — a project, a channel, a
 * teammate, a run — so the checklist cannot claim a setup that is not there, and a step a
 * person skipped turns `done` by itself once they do it later. Only *skips* and the dismissal
 * of the whole card are stored, in `onboarding_progress`, per workspace.
 */
export interface OnboardingOptions {
  db: ProjectRegistryServiceOptions['db'];
  workspaceId: string;
  /** Whether a model provider is in effect now (environment or Settings). */
  aiConfigured: () => Promise<boolean>;
}

const CHECKLIST = 'checklist';

const STEP_META: Record<OnboardingStepId, Pick<OnboardingStep, 'title' | 'who' | 'href'>> = {
  workspace: { title: 'Create your workspace', who: 'admin', href: '/dashboard/settings/members' },
  repository: {
    title: 'Connect a repository',
    who: 'operator',
    href: '/dashboard/settings/projects',
  },
  ai: { title: 'Connect an AI provider', who: 'admin', href: '/dashboard/settings/ai' },
  notifications: {
    title: 'Choose where reports go',
    who: 'admin',
    href: '/dashboard/settings/reports',
  },
  teammates: { title: 'Invite your teammates', who: 'admin', href: '/dashboard/settings/members' },
  'first-run': { title: 'Run your first check', who: 'operator', href: '/dashboard/runner' },
};

async function has(
  options: OnboardingOptions,
  table: typeof projects | typeof notificationChannels | typeof workspaceMembers | typeof runs,
): Promise<boolean> {
  const [row] = await options.db
    .select({ n: count() })
    .from(table)
    .where(eq(table.workspaceId, options.workspaceId));
  return Number(row?.n ?? 0) > 0;
}

export async function readOnboarding(options: OnboardingOptions): Promise<Onboarding> {
  const [project, channel, member, run, ai, stored] = await Promise.all([
    has(options, projects),
    has(options, notificationChannels),
    has(options, workspaceMembers),
    has(options, runs),
    options.aiConfigured(),
    options.db
      .select()
      .from(onboardingProgress)
      .where(eq(onboardingProgress.workspaceId, options.workspaceId)),
  ]);
  const skipped = new Set(stored.map((row) => row.step));
  const facts: Record<OnboardingStepId, boolean> = {
    // The workspace exists by the time anyone can read this; the step is here so the count
    // starts at one, which tells a person they have already begun.
    workspace: true,
    repository: project,
    ai,
    notifications: channel,
    teammates: member,
    'first-run': run,
  };
  const steps: OnboardingStep[] = ONBOARDING_STEPS.map((id) => ({
    id,
    ...STEP_META[id],
    state: facts[id] ? 'done' : skipped.has(id) ? 'skipped' : 'todo',
  }));
  return {
    steps,
    done: steps.filter((step) => step.state === 'done').length,
    total: steps.length,
    dismissed: skipped.has(CHECKLIST),
  };
}

/** Records that a step was skipped, or (`checklist`) that the whole card was dismissed. */
export async function dismissOnboardingStep(
  options: OnboardingOptions,
  step: string,
  actor: string,
): Promise<void> {
  if (step !== CHECKLIST && !(ONBOARDING_STEPS as readonly string[]).includes(step)) {
    throw new DomainError(ErrorCode.NOT_FOUND, `There is no setup step called ${step}.`);
  }
  const now = new Date();
  await options.db
    .insert(onboardingProgress)
    .values({
      workspaceId: options.workspaceId,
      step,
      state: 'skipped',
      updatedBy: actor,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [onboardingProgress.workspaceId, onboardingProgress.step],
      set: { state: 'skipped', updatedBy: actor, updatedAt: now },
    });
}

/** Undoes every skip and the dismissal, so the wizard can be run again from Settings. */
export async function resetOnboarding(options: OnboardingOptions): Promise<void> {
  await options.db
    .delete(onboardingProgress)
    .where(and(eq(onboardingProgress.workspaceId, options.workspaceId)));
}
