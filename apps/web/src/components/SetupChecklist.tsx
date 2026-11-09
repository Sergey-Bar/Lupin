import React from 'react';
import { Button, Check, X } from '@lupin/ui';
import type { Onboarding } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { ViewerRole } from '../route-manifest.js';
import { roleMeets } from '../route-manifest.js';

/**
 * "Get set up", on the cockpit, for whatever setup left undone.
 *
 * One line of progress, the next step as the action, and the rest as links. It disappears at
 * six of six, and an admin can dismiss it. A viewer sees the same list read-only, each step
 * saying who can finish it, because "ask an admin" is an answer and a dead button is not.
 */
export interface SetupChecklistSource {
  load: () => Promise<Onboarding>;
  dismiss: () => Promise<unknown>;
  role: () => Promise<ViewerRole | null>;
}

const ROLE_NAMES: Record<ViewerRole, string> = {
  viewer: 'a viewer',
  operator: 'an operator',
  admin: 'an admin',
};

export function SetupChecklist({
  source,
}: {
  source: SetupChecklistSource;
}): React.ReactElement | null {
  const [version, setVersion] = React.useState(0);
  const [hidden, setHidden] = React.useState(false);
  const state = useResource(
    async () => ({ onboarding: await source.load(), role: await source.role() }),
    [source, version],
  );
  if (hidden || state.status !== 'ready') return null;
  const { onboarding, role } = state.value;
  if (onboarding.dismissed || onboarding.done >= onboarding.total) return null;
  const left = onboarding.steps.filter((step) => step.state !== 'done');
  const next =
    left.find((step) => roleMeets(step.who === 'viewer' ? undefined : step.who, role)) ?? left[0];
  const admin = role === 'admin';
  return (
    <section
      aria-labelledby="setup-checklist-title"
      data-testid="setup-checklist"
      data-chrome="secondary"
      className="grid gap-2 rounded-lg bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="setup-checklist-title" className="min-w-0 text-sm text-fg">
          <span data-testid="setup-checklist-progress">
            <span className="font-medium">
              Setup {onboarding.done} of {onboarding.total}
            </span>
            {next === undefined ? null : (
              <span className="text-fg-muted"> · Next: {next.title.toLowerCase()}</span>
            )}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {next !== undefined && roleMeets(next.who === 'viewer' ? undefined : next.who, role) ? (
            <a
              href="/dashboard/setup"
              className="inline-flex min-h-9 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Continue setup
            </a>
          ) : null}
          {admin ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Dismiss the setup checklist"
              onClick={() => {
                setHidden(true);
                void source.dismiss().finally(() => setVersion((count) => count + 1));
              }}
            >
              <X aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={onboarding.total}
        aria-valuenow={onboarding.done}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${String((onboarding.done / onboarding.total) * 100)}%` }}
        />
      </div>
      <details data-testid="setup-checklist-steps" className="text-sm">
        <summary className="cursor-pointer select-none rounded-md text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
          All steps
        </summary>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" aria-label="Setup steps">
          {onboarding.steps.map((step) => {
            const done = step.state === 'done';
            const allowed = roleMeets(step.who === 'viewer' ? undefined : step.who, role);
            return (
              <li
                key={step.id}
                className="flex items-center gap-2 text-sm"
                data-testid={`checklist-${step.id}`}
              >
                <span
                  aria-hidden
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${done ? 'border-success bg-success text-on-fill' : 'border-border'}`}
                >
                  {done ? <Check className="size-3" /> : null}
                </span>
                {done ? (
                  <span className="text-fg-muted line-through">
                    {step.title}
                    <span className="sr-only">, done</span>
                  </span>
                ) : allowed ? (
                  <a
                    className="text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    href={step.href}
                  >
                    {step.title}
                    {step.state === 'skipped' ? (
                      <span className="text-fg-muted"> (skipped)</span>
                    ) : null}
                  </a>
                ) : (
                  <span className="text-fg-muted">
                    {step.title} — ask {ROLE_NAMES[step.who]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
