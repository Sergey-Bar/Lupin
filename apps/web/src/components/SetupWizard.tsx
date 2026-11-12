import React from 'react';
import { Button, ButtonLink, CircleCheck, Wordmark } from '@lupin/ui';
import type { Onboarding, OnboardingStepId } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { HealthClient, WhoAmI } from '../lib/health-client.js';
import type { NotificationsClient } from '../lib/notifications-client.js';
import type { QaClient } from '../lib/qa-client.js';
import { canAdminister, canAdministerInstallation, canOperate } from '../lib/roles.js';
import { explain, type SettingsClient } from '../lib/settings-client.js';
import { AccessGate } from './Access.js';
import { UserText } from './Bidi.js';
import { ConnectRepository } from './ConnectRepository.js';
import { Panel } from './kit.js';
import { SettingsForm } from './SettingsForm.js';
import { useToast } from './Toasts.js';
import { SETUP_LATER_KEY, putOffSetup as putOff } from '../lib/first-run.js';

export { SETUP_LATER_KEY };

/**
 * First-run setup: six steps from an empty install to a first run, without a terminal.
 *
 * - **Progress is the server's**, derived from what exists (`GET /api/v1/onboarding`), so a
 *   reload, a second tab or a step done elsewhere is reflected, and the wizard resumes at the
 *   first step not yet done.
 * - **Every step can be skipped and come back to.** Skipping is recorded, and the cockpit's
 *   checklist offers the skipped steps later.
 * - **Focus follows the step**: each step's heading takes focus when it opens, so a keyboard
 *   or screen-reader user hears where they are.
 */
export interface SetupClients {
  health: HealthClient;
  settings: SettingsClient;
  qa: QaClient;
  notifications: NotificationsClient;
}

const STEP_COPY: Record<OnboardingStepId, { title: string; why: string }> = {
  workspace: {
    title: 'Welcome',
    why: 'Lupin reads your repositories and test results and tells you whether quality is getting better or worse. Setup takes a few minutes.',
  },
  repository: {
    title: 'Connect a repository',
    why: 'Lupin scans it for test commands, coverage and reports. Nothing is changed in your code.',
  },
  ai: {
    title: 'Connect an AI provider',
    why: 'Optional. Powers chat, test proposals and evals. You can use a local Ollama server so nothing leaves your network.',
  },
  notifications: {
    title: 'Choose where reports go',
    why: 'A daily or weekly quality report. The Lupin inbox needs no account, so it is a good place to start.',
  },
  teammates: {
    title: 'Invite your teammates',
    why: 'Give people their own sign-in and the role they need: viewer, operator or admin.',
  },
  'first-run': {
    title: 'Run your first check',
    why: 'Run one of the commands Lupin found, and watch the result arrive.',
  },
};

/**
 * The order a first-time reader meets the steps: a repository, then its first run, so a real
 * result arrives before anything optional is asked. The server's list is the progress, this
 * is only the order it is walked in.
 */
const STEP_ORDER: readonly OnboardingStepId[] = [
  'workspace',
  'repository',
  'first-run',
  'ai',
  'notifications',
  'teammates',
];

function inOrder(steps: Onboarding['steps']): Onboarding['steps'] {
  const rank = (id: OnboardingStepId) => STEP_ORDER.indexOf(id);
  return [...steps].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * One segment per step, together the progress bar. Each segment is a button that jumps to its
 * step; its title is read out, the bar is what is seen.
 */
function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: Onboarding['steps'];
  current: number;
  onSelect: (index: number) => void;
}): React.ReactElement {
  return (
    <ol aria-label="Setup steps" className="grid grid-cols-6 gap-1.5">
      {steps.map((step, index) => {
        const done = step.state === 'done';
        const here = index === current;
        return (
          <li key={step.id}>
            <button
              type="button"
              data-step={step.id}
              aria-current={here ? 'step' : undefined}
              title={STEP_COPY[step.id].title}
              onClick={() => onSelect(index)}
              className="group block w-full rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <span
                aria-hidden
                className={`block h-1.5 rounded-full transition-colors duration-100 motion-reduce:transition-none ${
                  here
                    ? 'bg-primary'
                    : done
                      ? 'bg-success'
                      : 'bg-surface-muted group-hover:bg-border-strong'
                }`}
              />
              <span className="sr-only">
                {STEP_COPY[step.id].title}
                {done ? ', done' : step.state === 'skipped' ? ', skipped' : ', to do'}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The last step hands over to the runner rather than starting a run itself: the runner is
 * where a run is confirmed with its exact command on screen, and a second way to start one
 * would be a second place that decision is made. The step completes when the first run lands.
 */
function FirstRun({ qa, who }: { qa: QaClient; who: WhoAmI }): React.ReactElement {
  const projects = useResource(() => qa.listProjects(), [qa]);
  if (projects.status === 'loading') {
    return (
      <p role="status" className="text-sm text-fg-muted">
        Reading projects…
      </p>
    );
  }
  if (projects.status === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        {projects.message}
      </p>
    );
  }
  const project = projects.value[0];
  if (project === undefined) {
    return <p className="text-sm text-fg-muted">Connect a repository first: go back to step 2.</p>;
  }
  if (!canOperate(who)) {
    return (
      <p className="text-sm text-fg-muted">Ask an operator or admin to start the first run.</p>
    );
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm text-fg">
        The runner lists the commands Lupin found in{' '}
        <UserText className="font-medium">{project.name}</UserText>. Pick one, check the exact
        command it will run, and start it.
      </p>
      <div>
        <ButtonLink href="/dashboard/runner">Open the runner</ButtonLink>
      </div>
      <p className="text-sm text-fg-muted">
        No command to run here? Upload results from CI with the lupin CLI instead; this step
        completes either way.
      </p>
    </div>
  );
}

function StepBody({
  step,
  clients,
  who,
  onProgress,
}: {
  step: OnboardingStepId;
  clients: SetupClients;
  who: WhoAmI;
  onProgress: () => void;
}): React.ReactElement {
  const toast = useToast();
  switch (step) {
    case 'workspace':
      return (
        <ul className="grid gap-2 text-sm text-fg">
          <li>1. Connect the repository you want analysed.</li>
          <li>2. Optionally connect an AI provider and a place for reports.</li>
          <li>3. Invite your team, and run your first check.</li>
        </ul>
      );
    case 'repository':
      return canOperate(who) ? (
        <ConnectRepository client={clients.settings} onConnected={onProgress} />
      ) : (
        <p className="text-sm text-fg-muted">Ask an operator or admin to connect a repository.</p>
      );
    case 'ai':
      return (
        <SettingsForm
          client={clients.settings}
          group="ai"
          title="AI provider"
          canEdit={canAdministerInstallation(who)}
          testKey="ai.gatewayUrl"
          onSaved={onProgress}
        />
      );
    case 'notifications':
      return canAdminister(who) ? (
        <div className="grid gap-3">
          <div>
            <Button
              type="button"
              className="min-h-10"
              onClick={() =>
                void clients.notifications
                  .createChannel({ kind: 'inbox', name: 'Lupin inbox', settings: {} })
                  .then(() => {
                    toast({ tone: 'success', title: 'Lupin inbox added' });
                    onProgress();
                  })
                  .catch((error: unknown) =>
                    toast({
                      tone: 'danger',
                      title: 'Could not add the inbox',
                      description: explain(error, 'The request failed.'),
                    }),
                  )
              }
            >
              Use the Lupin inbox
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            Prefer Slack, Teams, Telegram, WhatsApp, Signal or email?{' '}
            <a
              className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              href="/dashboard/settings/reports"
            >
              Set it up in Reports
            </a>
            .
          </p>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Ask an admin to choose where reports go.</p>
      );
    case 'teammates':
      return (
        <p className="text-sm text-fg">
          <a
            className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            href="/dashboard/settings/members"
          >
            Open Members
          </a>{' '}
          to invite people by email and choose their role. This step completes when the first person
          joins.
        </p>
      );
    case 'first-run':
      return <FirstRun qa={clients.qa} who={who} />;
  }
}

function Finished({
  steps,
  done,
  total,
  heading,
}: {
  steps: Onboarding['steps'];
  done: number;
  total: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
}): React.ReactElement {
  const left = steps.filter((step) => step.state !== 'done');
  return (
    <Panel title="Setup">
      <div className="grid gap-4" data-testid="setup-finished">
        <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
          {left.length === 0 ? 'You’re set up' : 'You’re ready to go'}
        </h2>
        <p className="text-sm text-fg-muted">
          {done} of {total} steps done.{' '}
          {left.length === 0
            ? 'Everything is connected.'
            : 'The dashboard keeps a checklist of what is left, so you can finish later.'}
        </p>
        {left.length === 0 ? null : (
          <ul className="grid gap-1 text-sm">
            {left.map((step) => (
              <li key={step.id}>
                <a
                  className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  href={step.href}
                >
                  {STEP_COPY[step.id].title}
                </a>
              </li>
            ))}
          </ul>
        )}
        <div>
          <ButtonLink href="/dashboard/now">Go to Home</ButtonLink>
        </div>
      </div>
    </Panel>
  );
}

function Wizard({ clients, who }: { clients: SetupClients; who: WhoAmI }): React.ReactElement {
  const toast = useToast();
  const [version, setVersion] = React.useState(0);
  const onboarding = useResource(
    () => clients.settings.getOnboarding(),
    [clients.settings, version],
  );
  const [current, setCurrent] = React.useState<number | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const moved = React.useRef(false);

  // Resume at the first step not done, once, when progress first arrives.
  React.useEffect(() => {
    if (onboarding.status !== 'ready' || current !== null) return;
    const next = inOrder(onboarding.value.steps).findIndex((step) => step.state === 'todo');
    setCurrent(next === -1 ? onboarding.value.steps.length : next);
  }, [onboarding, current]);

  React.useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [current]);

  if (onboarding.status === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        Setup could not be read: {onboarding.message}
      </p>
    );
  }
  if (onboarding.status === 'loading' || current === null) {
    return (
      <p role="status" className="text-sm text-fg-muted">
        Reading your setup…
      </p>
    );
  }
  const { done, total } = onboarding.value;
  const steps = inOrder(onboarding.value.steps);
  const go = (index: number) => {
    moved.current = true;
    setCurrent(Math.max(0, Math.min(index, steps.length)));
  };
  const refresh = () => setVersion((count) => count + 1);

  if (current >= steps.length) {
    return <Finished steps={steps} done={done} total={total} heading={heading} />;
  }

  const step = steps[current];
  if (step === undefined) return <></>;
  const copy = STEP_COPY[step.id];
  const skip = () => {
    if (!canAdminister(who)) {
      go(current + 1);
      return;
    }
    clients.settings
      .dismissStep(step.id)
      .then(() => {
        refresh();
        go(current + 1);
      })
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Could not skip',
          description: explain(error, 'The request failed.'),
        }),
      );
  };

  // A column held to the height the page gives it, with the step as the part that scrolls: a
  // long step scrolls inside its card, and the page itself never does (the no-scroll contract).
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid shrink-0 gap-1">
        <div className="flex items-baseline justify-between gap-3 text-xs text-fg-muted">
          <span>
            Step {current + 1} of {steps.length}
          </span>
          <span data-testid="setup-progress">
            {done} of {total} done
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="sr-only"
        />
        <Stepper steps={steps} current={current} onSelect={go} />
      </div>
      <section
        aria-labelledby="setup-step-title"
        className="grid min-h-0 content-start gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-5 sm:p-6 animate-fade-in"
        key={step.id}
      >
        <div className="grid gap-1">
          <h2
            id="setup-step-title"
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold text-fg outline-none"
          >
            {copy.title}
          </h2>
          <p className="max-w-measure text-sm text-pretty text-fg-muted">{copy.why}</p>
          {step.state === 'done' ? (
            <p className="flex items-center gap-1.5 text-sm text-success" role="status">
              <CircleCheck aria-hidden className="size-4" /> Done
            </p>
          ) : step.state === 'skipped' ? (
            <p className="text-sm text-fg-muted">Skipped</p>
          ) : null}
        </div>
        <StepBody step={step.id} clients={clients} who={who} onProgress={refresh} />
        <div
          data-testid="setup-actions"
          className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center gap-3 rounded-b-lg border-t border-border bg-surface px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6"
        >
          {current > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-10"
              onClick={() => go(current - 1)}
            >
              Back
            </Button>
          ) : null}
          <span className="flex-1" />
          {step.state === 'done' || step.id === 'workspace' ? (
            <Button type="button" className="min-h-10" onClick={() => go(current + 1)}>
              Continue
            </Button>
          ) : (
            <Button type="button" variant="ghost" className="min-h-10" onClick={skip}>
              Skip for now
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

export function SetupPage({ clients }: { clients: SetupClients }): React.ReactElement {
  // Full-screen, outside the app frame: the root draws no sidebar or bars on this path.
  return (
    <div
      data-testid="setup-page"
      className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-6 py-2 sm:py-8"
    >
      <header className="flex shrink-0 items-center justify-between gap-3">
        <Wordmark decorative />
        <a
          href="/dashboard/now"
          onClick={putOff}
          className="inline-flex min-h-10 items-center rounded-md px-2 text-sm text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Do this later
        </a>
      </header>
      <div className="grid shrink-0 gap-1">
        <h1 className="text-2xl font-semibold text-fg">Set up Lupin</h1>
        <p className="text-sm text-fg-muted">
          From an empty install to your first run. Skip anything and come back later.
        </p>
      </div>
      <AccessGate health={clients.health}>
        {(who) => <Wizard clients={clients} who={who} />}
      </AccessGate>
    </div>
  );
}
