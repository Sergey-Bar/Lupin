import React from 'react';
import { Button, EmptyState, Select } from '@lupin/ui';
import { useResource } from '../hooks/useResource.js';
import { useViewerRole } from '../hooks/useViewerRole.js';
import type { QaClient } from '../lib/qa-client.js';
import type { RegisteredProject } from '../lib/qa.js';
import { PageFrame, PageHeader, Quiet } from './kit.js';
import { isNothingYet } from '../lib/nothing-yet.js';

/**
 * Reads the registry once and hands each project-scoped screen its subject.
 *
 * ## Onboarding is a screen, not an empty grid
 *
 * The dashboard, the runner, the health page and the toolbox all report on one
 * repository. With none registered there is nothing for any of them to say, and an empty
 * grid cannot distinguish "no project yet" from "the API is broken" — the two need
 * opposite responses. So the four screens share this gate rather than each deciding what
 * an empty registry looks like, and the onboarding copy is written once.
 */
export function ProjectGate({
  qa,
  title,
  projectId,
  children,
}: {
  qa: QaClient;
  /** The screen's own name, so a loading or empty state still has an `h1`. */
  title: string;
  projectId?: string;
  /**
   * The screen, given its subject and the switcher to place in its header. The switcher is
   * `null` with one project registered, because a choice of one is not a control.
   */
  children: (project: RegisteredProject, switcher: React.ReactNode) => React.ReactNode;
}): React.ReactElement {
  const [attempt, setAttempt] = React.useState(0);
  const registry = useResource<RegisteredProject[]>(() => qa.listProjects(), [qa, attempt]);
  const [chosen, choose] = React.useState<string | null>(() => readChoice());
  if (registry.status === 'loading') {
    return (
      <PageFrame data-testid="project-gate-loading">
        <PageHeader title={title} />
        <Quiet>Reading the registry…</Quiet>
      </PageFrame>
    );
  }
  if (registry.status === 'error') {
    // A bare "not found" means the registry has nothing yet (the same rule the cockpit uses),
    // so the reader gets the way in rather than a sentence they cannot act on.
    if (isNothingYet(registry.message)) return <Onboarding title={title} />;
    return (
      <PageFrame>
        <PageHeader title={title} />
        <EmptyState
          headingLevel={2}
          data-testid="project-gate-error"
          title="Can't load your projects"
          description={registry.message}
          action={
            <div className="grid justify-items-center gap-3">
              <Button onClick={() => setAttempt((count) => count + 1)}>Try again</Button>
              {registry.detail === undefined ? null : (
                <details className="text-xs text-fg-muted">
                  <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
                    Technical details
                  </summary>
                  <p className="mt-1 font-mono">{registry.detail}</p>
                </details>
              )}
            </div>
          }
        />
      </PageFrame>
    );
  }
  const projects = registry.value;
  const subject =
    projectId === undefined
      ? (projects.find((project) => project.id === chosen) ?? projects[0])
      : projects.find((project) => project.id === projectId);
  if (subject === undefined) return <Onboarding title={title} />;
  const switcher =
    projectId === undefined && projects.length > 1 ? (
      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <span className="sr-only">Project</span>
        <Select
          data-testid="project-switcher"
          aria-label="Project"
          containerClassName="w-auto max-w-56"
          value={subject.id}
          onChange={(event) => {
            writeChoice(event.target.value);
            choose(event.target.value);
          }}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
        />
      </label>
    ) : null;
  return <>{children(subject, switcher)}</>;
}

/**
 * The chosen project, shared by every project screen and kept across reloads.
 *
 * `localStorage` rather than the URL because the choice is the reader's, not the page's:
 * moving from the dashboard to the runner should stay on the repository they picked.
 * A stored id that is no longer registered falls back to the first project.
 */
const CHOICE_KEY = 'lupin-project';

function readChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function writeChoice(projectId: string): void {
  try {
    localStorage.setItem(CHOICE_KEY, projectId);
  } catch {
    // A storage that refuses writes leaves the choice for this page only, which is still a choice.
  }
}

/**
 * An empty registry, said as a next step. An operator or admin gets the way in — setup, or
 * straight to connecting a repository — and a viewer is told who can do it, because a viewer
 * offered a button that answers 403 learns nothing. `onboarding` stays the test id, so the
 * screens that render this are still asserted the same way.
 */
function Onboarding({ title }: { title: string }): React.ReactElement {
  const role = useViewerRole();
  const canConnect = role === 'operator' || role === 'admin';
  return (
    <PageFrame data-testid="onboarding">
      <PageHeader title={title} subtitle="No project is connected yet." />
      <div className="flex flex-1 items-center justify-center rounded-lg bg-ambient">
        <div className="grid max-w-measure gap-4 rounded-lg border border-border bg-surface-raised p-8">
          <h2 className="text-xl font-semibold">Connect your first repository</h2>
          <p className="text-pretty text-sm text-fg-muted">
            Lupin scans a repository for its tests, coverage and reports, and this screen fills in.
            This is an empty install, not a failure.
          </p>
          {canConnect ? (
            <div className="flex flex-wrap gap-3">
              <a
                href={role === 'admin' ? '/dashboard/setup' : '/dashboard/settings/projects'}
                data-testid="onboarding-connect"
                className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-on-fill hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                {role === 'admin' ? 'Start setup' : 'Connect a repository'}
              </a>
              {role === 'admin' ? (
                <a
                  href="/dashboard/settings/projects"
                  className="inline-flex min-h-10 items-center text-sm text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  Just connect a repository
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-fg" data-testid="onboarding-ask">
              Ask an operator or admin of this workspace to connect a repository.
            </p>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
