import React from 'react';
import { Button, Input, cn } from '@lupin/ui';
import type { QaClient, RegisterProjectBody } from '../lib/qa-client.js';
import type { HealthClient } from '../lib/health-client.js';
import type { RegisteredProject } from '../lib/qa.js';
import { CopyButton, PageFrame, PageHeader, Panel, Quiet } from './kit.js';
import { Bdi, UserText } from './Bidi.js';
import { useToast } from './Toasts.js';

/**
 * Connections: every way something gets into Lupin, in one section.
 *
 * - **Repositories** — add a local folder or a Git URL, see what is registered, scan it.
 * - **GitHub** and **Chat apps** — the existing sync and notification surfaces, reached here.
 * - **CI** — the commands a pipeline runs to send results, ready to copy.
 *
 * Adding a repository is `POST /api/v1/projects`, which is operator-only; a viewer sees the
 * list and the refusal the API returns, never a button that pretends.
 */

/** A slug the API accepts (`^[a-z0-9][a-z0-9._-]*$`), derived from a name or a path. */
export function slugOf(text: string): string {
  const base = text.trim().split(/[\\/]/u).filter(Boolean).at(-1) ?? text;
  const slug = base
    .toLowerCase()
    .replace(/\.git$/u, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+|-+$/gu, '')
    .slice(0, 64);
  return slug === '' ? 'project' : slug;
}

type Source = 'folder' | 'git';

export function RepositoriesPage({
  qa,
  health,
}: {
  qa: QaClient;
  health: HealthClient;
}): React.ReactElement {
  const toast = useToast();
  const [projects, setProjects] = React.useState<RegisteredProject[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<Source>('folder');
  const [location, setLocation] = React.useState('');
  const [name, setName] = React.useState('');
  const [branch, setBranch] = React.useState('');
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = React.useId();

  const load = React.useCallback(() => {
    qa.listProjects()
      .then((list) => {
        setProjects(list);
        setLoadError(null);
      })
      .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : 'failed'));
  }, [qa]);
  React.useEffect(load, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const where = location.trim();
    if (where === '') {
      setError(source === 'folder' ? 'Enter the folder path.' : 'Enter the repository URL.');
      return;
    }
    const label = name.trim() === '' ? slugOf(where) : name.trim();
    const body: RegisterProjectBody =
      source === 'folder'
        ? { name: label, slug: slugOf(label), repoPath: where }
        : {
            name: label,
            slug: slugOf(label),
            gitUrl: where,
            ...(branch.trim() === '' ? {} : { defaultBranch: branch.trim() }),
            ...(token === '' ? {} : { token }),
          };
    setBusy(true);
    setError(null);
    try {
      await qa.registerProject(body);
      setLocation('');
      setName('');
      setBranch('');
      setToken('');
      toast({ title: `Added ${label}`, tone: 'success' });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The repository could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const scan = async (project: RegisteredProject) => {
    try {
      await health.startScan(project.id);
      toast({ title: `Scanning ${project.name}`, tone: 'success' });
    } catch (cause) {
      toast({
        title: `Could not scan ${project.name}`,
        ...(cause instanceof Error ? { description: cause.message } : {}),
        tone: 'danger',
      });
    }
  };

  return (
    <PageFrame data-testid="connections-repositories">
      <PageHeader title="Repositories" subtitle="The code Lupin reads, scans and reports on." />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-6">
        <Panel title="Registered" scrollLabel="Registered repositories">
          {loadError !== null ? (
            <Quiet>The list could not be read: {loadError}</Quiet>
          ) : projects === null ? (
            <Quiet>Loading…</Quiet>
          ) : projects.length === 0 ? (
            <Quiet>Nothing yet. Add a folder or a Git URL to start.</Quiet>
          ) : (
            <ul aria-label="Registered repositories" className="flex flex-col">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      <UserText>{project.name}</UserText>
                    </div>
                    <div className="truncate font-mono text-xs text-fg-muted">
                      <Bdi>{project.repoPath ?? 'Cloned for each scan'}</Bdi>
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => void scan(project)}>
                    Scan now
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Add a repository">
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
            <div role="radiogroup" aria-label="Source" className="flex gap-2">
              {(
                [
                  ['folder', 'Local folder'],
                  ['git', 'Git URL'],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={source === value}
                  onClick={() => {
                    setSource(value);
                    setError(null);
                  }}
                  className={cn(
                    'min-h-11 flex-1 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                    source === value
                      ? 'bg-surface-muted text-fg'
                      : 'text-fg-muted hover:bg-surface-muted',
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
            <Input
              id={`${ids}-location`}
              label={source === 'folder' ? 'Folder path' : 'Repository URL'}
              placeholder={
                source === 'folder'
                  ? 'C:\\code\\my-app or /srv/my-app'
                  : 'https://github.com/org/repo'
              }
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
            <Input
              id={`${ids}-name`}
              label="Name (optional)"
              placeholder="Taken from the folder or URL"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {source === 'git' ? (
              <>
                <Input
                  id={`${ids}-branch`}
                  label="Default branch (optional)"
                  placeholder="main"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                />
                <Input
                  id={`${ids}-token`}
                  label="Access token (private repositories)"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </>
            ) : (
              <Quiet>The path is on the machine running the Lupin runner.</Quiet>
            )}
            {error === null ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add repository'}
            </Button>
          </form>
        </Panel>
      </div>
    </PageFrame>
  );
}

/** The commands a pipeline runs, ready to copy. `origin` is this install's address. */
export function ciSnippets(
  origin: string,
): ReadonlyArray<{ id: string; title: string; text: string }> {
  return [
    {
      id: 'env',
      title: 'Point the CLI at this install',
      text: `export LUPIN_URL=${origin}\nexport LUPIN_TOKEN=lup_your_uploader_token`,
    },
    {
      id: 'test',
      title: 'Run tests and send the results',
      text: 'npx @lupin/cli test --format junit --report results.xml -- npm test',
    },
    {
      id: 'upload',
      title: 'Send a report you already have',
      text: 'npx @lupin/cli upload --format junit --file results.xml',
    },
    {
      id: 'gate',
      title: 'Fail the build on a no-go verdict',
      text: 'npx @lupin/cli gate --branch "$BRANCH" --commit "$SHA"',
    },
    {
      id: 'action',
      title: 'GitHub Actions',
      text: [
        '- uses: Sergey-Bar/Lupin/.github/actions/lupin-health@main',
        '  with:',
        `    url: ${origin}`,
        '    project-id: your-project-id',
        '    token: ${{ secrets.LUPIN_TOKEN }}',
      ].join('\n'),
    },
  ];
}

export function CiPage({
  origin = window.location.origin,
}: {
  origin?: string;
}): React.ReactElement {
  return (
    <PageFrame data-testid="connections-ci">
      <PageHeader
        title="CI"
        subtitle="Send test results and gate releases from your pipeline. Create an uploader token under Settings → Access."
      />
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-6">
        {ciSnippets(origin).map((snippet) => (
          <Panel
            key={snippet.id}
            title={snippet.title}
            action={<CopyButton text={snippet.text} label={snippet.title} />}
          >
            <pre className="overflow-x-auto rounded-md bg-surface-sunken p-3 text-xs">
              <code>{snippet.text}</code>
            </pre>
          </Panel>
        ))}
      </div>
    </PageFrame>
  );
}
