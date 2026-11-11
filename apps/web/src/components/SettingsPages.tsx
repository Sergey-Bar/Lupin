import React from 'react';
import { Badge, Button, Input } from '@lupin/ui';
import type { SettingGroup } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { HealthClient, WhoAmI } from '../lib/health-client.js';
import type { RegisteredProject } from '../lib/qa.js';
import type { QaClient } from '../lib/qa-client.js';
import { canAdminister, canAdministerInstallation, canOperate } from '../lib/roles.js';
import { explain, type QualityGate, type SettingsClient } from '../lib/settings-client.js';
import { AccessGate } from './Access.js';
import { ConfirmAction } from './ConfirmAction.js';
import { Bdi, UserText } from './Bidi.js';
import { ConnectRepository } from './ConnectRepository.js';
import { PageBody, PageFrame, PageHeader, Panel } from './kit.js';
import { SettingsForm } from './SettingsForm.js';
import { useToast } from './Toasts.js';

/**
 * The Settings tabs that used to be environment variables, and the workspace tabs that had an
 * API and no screen. Each page is one subject, one sentence of why, and the form.
 */
interface GroupPage {
  group: SettingGroup;
  title: string;
  subtitle: string;
  sections: ReadonlyArray<{ title: string; keys?: readonly string[] }>;
  testKey?: string;
}

const GROUP_PAGES: Record<'ai' | 'integrations' | 'sessions-retention', GroupPage> = {
  ai: {
    group: 'ai',
    title: 'AI provider',
    subtitle:
      'The model behind chat, test proposals and evals. Use a gateway with an API key, or a local Ollama server so prompts stay on your network.',
    sections: [{ title: 'Provider' }],
    testKey: 'ai.gatewayUrl',
  },
  integrations: {
    group: 'integrations',
    title: 'Integrations',
    subtitle:
      'GitHub, Slack and webhooks. Every secret is stored encrypted and is never shown again.',
    sections: [{ title: 'Connections' }],
    testKey: 'integrations.githubApiUrl',
  },
  'sessions-retention': {
    group: 'sessions-retention',
    title: 'Sessions & retention',
    subtitle:
      'How long people stay signed in, and how long records are kept before they are deleted.',
    sections: [{ title: 'Lifetimes' }],
  },
};

function InstallationGroupPage({
  page,
  health,
  client,
  children,
}: {
  page: GroupPage;
  health: HealthClient;
  client: SettingsClient;
  /** More of the page, under the form, for a reader who may administer it. */
  children?: (who: WhoAmI) => React.ReactNode;
}): React.ReactElement {
  return (
    <PageFrame data-testid={`settings-${page.group}`}>
      <PageHeader title={page.title} subtitle={page.subtitle} />
      <PageBody>
        <AccessGate health={health}>
          {(who) =>
            canAdminister(who) ? (
              <>
                <Panel title={page.sections[0]?.title ?? page.title}>
                  <SettingsForm
                    client={client}
                    group={page.group}
                    title={page.title}
                    canEdit={canAdministerInstallation(who)}
                    {...(page.testKey === undefined ? {} : { testKey: page.testKey })}
                  />
                </Panel>
                {children?.(who)}
              </>
            ) : (
              <AskAnAdmin who={who} />
            )
          }
        </AccessGate>
      </PageBody>
    </PageFrame>
  );
}

function AskAnAdmin({ who }: { who: WhoAmI }): React.ReactElement {
  return (
    <p role="note" className="max-w-measure text-sm text-fg-muted" data-testid="ask-an-admin">
      You have the {who.role ?? 'guest'} role here. Ask an admin of this workspace to change these
      settings.
    </p>
  );
}

export function AiSettingsPage(props: {
  health: HealthClient;
  client: SettingsClient;
}): React.ReactElement {
  return <InstallationGroupPage page={GROUP_PAGES.ai} {...props} />;
}

export function IntegrationsSettingsPage(props: {
  health: HealthClient;
  client: SettingsClient;
}): React.ReactElement {
  return (
    <InstallationGroupPage page={GROUP_PAGES.integrations} {...props}>
      {(who) => <GitHubAppPanel client={props.client} canEdit={canAdminister(who)} />}
    </InstallationGroupPage>
  );
}

/**
 * The workspace's GitHub App: whether one is set, and an admin's paste of its App ID and
 * private key. The server then posts as the app, with a token per repository it is installed
 * on; a project's own token still wins. The key is never shown again.
 */
function GitHubAppPanel({
  client,
  canEdit,
}: {
  client: SettingsClient;
  canEdit: boolean;
}): React.ReactElement {
  const toast = useToast();
  const [version, setVersion] = React.useState(0);
  const state = useResource(() => client.githubAppState(), [client, version]);
  const [appId, setAppId] = React.useState('');
  const [privateKey, setPrivateKey] = React.useState('');
  const id = React.useId();
  const act = (action: () => Promise<void>, success: string) =>
    action().then(
      () => {
        toast({ tone: 'success', title: success });
        setAppId('');
        setPrivateKey('');
        setVersion((count) => count + 1);
      },
      (error: unknown) =>
        toast({
          tone: 'danger',
          title: 'GitHub App',
          description: explain(error, 'The request failed.'),
        }),
    );
  const set = state.status === 'ready' && state.value;
  return (
    <Panel
      title="GitHub App"
      data-testid="github-app"
      action={
        state.status === 'ready' ? (
          <Badge variant={set ? 'success' : 'outline'}>{set ? 'Connected' : 'Not set'}</Badge>
        ) : null
      }
    >
      <div className="grid gap-3">
        <p className="max-w-measure text-sm text-fg-muted">
          Post statuses, check runs and comments as your GitHub App instead of a person’s token.
          Install the app on the repositories, then paste its App ID and a private key it generated.
          A project with its own token keeps using it.
        </p>
        {canEdit ? (
          <form
            className="grid gap-3"
            aria-label="GitHub App"
            onSubmit={(event) => {
              event.preventDefault();
              void act(() => client.putGitHubApp({ appId, privateKey }), 'GitHub App saved');
            }}
          >
            <Input
              id={`${id}-app-id`}
              label="App ID"
              value={appId}
              inputMode="numeric"
              required
              onChange={(event) => setAppId(event.target.value)}
            />
            <label className="grid gap-1 text-sm" htmlFor={`${id}-key`}>
              <span className="font-medium text-fg">Private key (.pem)</span>
              <textarea
                id={`${id}-key`}
                value={privateKey}
                required
                rows={4}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setPrivateKey(event.target.value)}
                className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline">
                {set ? 'Replace the app' : 'Save the app'}
              </Button>
              {set ? (
                <ConfirmAction
                  label="Remove"
                  title="Remove the GitHub App?"
                  consequence="Statuses, check runs and comments stop posting as the app at once. A project with its own token keeps posting with it."
                  typed="GitHub App"
                  onConfirm={() => act(() => client.deleteGitHubApp(), 'GitHub App removed')}
                />
              ) : null}
            </div>
          </form>
        ) : (
          <p className="max-w-measure text-sm text-fg-muted">
            Ask an admin to connect a GitHub App.
          </p>
        )}
      </div>
    </Panel>
  );
}

export function SessionsSettingsPage(props: {
  health: HealthClient;
  client: SettingsClient;
}): React.ReactElement {
  return <InstallationGroupPage page={GROUP_PAGES['sessions-retention']} {...props} />;
}

// ─── Projects ───────────────────────────────────────────────────────────────

/** Runs one project action: a toast either way, and a refresh after success. */
type RunAction = (
  action: () => Promise<unknown>,
  success: string,
  failure: string,
) => Promise<void>;

function RenameForm({
  project,
  client,
  busy,
  run,
}: {
  project: RegisteredProject;
  client: SettingsClient;
  busy: boolean;
  run: RunAction;
}): React.ReactElement {
  const id = React.useId();
  const [name, setName] = React.useState(project.name);
  const next = name.trim();
  return (
    <form
      aria-label={`Rename ${project.name}`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => client.updateProject(project.id, { name: next }),
          'Project renamed',
          'Could not rename',
        );
      }}
    >
      <Input
        id={`${id}-name`}
        label="New name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        loading={busy}
        disabled={next === '' || next === project.name}
      >
        Save name
      </Button>
    </form>
  );
}

function TokenForm({
  project,
  client,
  busy,
  run,
  hasToken,
}: {
  project: RegisteredProject;
  client: SettingsClient;
  busy: boolean;
  run: RunAction;
  hasToken: boolean;
}): React.ReactElement {
  const id = React.useId();
  const [token, setToken] = React.useState('');
  return (
    <form
      aria-label={`Access token for ${project.name}`}
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => client.putGitToken(project.id, token.trim()),
          'Token saved',
          'Could not save the token',
        );
      }}
    >
      <Input
        id={`${id}-token`}
        label={hasToken ? 'Replace the access token' : 'Access token'}
        type="password"
        autoComplete="off"
        helperText="For a private repository. Stored encrypted and only handed to the runner that clones it."
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={token.trim() === ''}>
          Save token
        </Button>
        {hasToken ? (
          <ConfirmAction
            label="Remove token"
            variant="outline"
            title="Remove this project's access token?"
            consequence="Lupin stops reading the repository with it; the workspace's GitHub App, if one is set, is used instead."
            onConfirm={() =>
              run(
                () => client.deleteGitToken(project.id),
                'Token removed',
                'Could not remove the token',
              )
            }
          />
        ) : null}
      </div>
    </form>
  );
}

function DeleteForm({
  project,
  client,
  busy,
  run,
}: {
  project: RegisteredProject;
  client: SettingsClient;
  busy: boolean;
  run: RunAction;
}): React.ReactElement {
  const id = React.useId();
  const [confirm, setConfirm] = React.useState('');
  return (
    <form
      aria-label={`Delete ${project.name}`}
      className="grid gap-2 rounded-md border border-danger p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => client.deleteProject(project.id, confirm),
          'Project deleted',
          'Could not delete',
        );
      }}
    >
      <p className="text-sm text-fg">
        This deletes the project and all of its history: runs, scores and health reports. It cannot
        be undone.
      </p>
      <Input
        id={`${id}-confirm`}
        label={`Type ${project.name} to confirm`}
        value={confirm}
        autoComplete="off"
        onChange={(event) => setConfirm(event.target.value)}
      />
      <div>
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          loading={busy}
          disabled={confirm !== project.name}
        >
          Delete project
        </Button>
      </div>
    </form>
  );
}

type RowMode = 'view' | 'rename' | 'token' | 'delete';

/** The buttons a role may use on a project: operators rename and re-scan, admins also token and delete. */
function RowActions({
  project,
  who,
  busy,
  mode,
  toggle,
  onRescan,
}: {
  project: RegisteredProject;
  who: WhoAmI;
  busy: boolean;
  mode: RowMode;
  toggle: (mode: RowMode) => void;
  onRescan: () => void;
}): React.ReactElement {
  return (
    <>
      {canOperate(who) ? (
        <>
          <Button size="sm" variant="outline" onClick={() => toggle('rename')}>
            Rename
          </Button>
          {project.repoPath === null ? null : (
            <Button
              size="sm"
              variant="outline"
              loading={busy && mode === 'view'}
              onClick={onRescan}
            >
              Re-scan
            </Button>
          )}
        </>
      ) : null}
      {canAdminister(who) ? (
        <>
          <Button size="sm" variant="outline" onClick={() => toggle('token')}>
            Access token
          </Button>
          <Button size="sm" variant="outline" onClick={() => toggle('delete')}>
            Delete
          </Button>
        </>
      ) : null}
    </>
  );
}

function ProjectRow({
  project,
  client,
  who,
  onChanged,
}: {
  project: RegisteredProject;
  client: SettingsClient;
  who: WhoAmI;
  onChanged: () => void;
}): React.ReactElement {
  const toast = useToast();
  const [mode, setMode] = React.useState<RowMode>('view');
  const [busy, setBusy] = React.useState(false);
  const [tokenVersion, setTokenVersion] = React.useState(0);
  const tokenState = useResource(
    () => client.gitTokenState(project.id),
    [client, project.id, tokenVersion],
  );
  const hasToken = tokenState.status === 'ready' && tokenState.value;

  const run: RunAction = async (action, success, failure) => {
    setBusy(true);
    try {
      await action();
      toast({ tone: 'success', title: success });
      setMode('view');
      setTokenVersion((count) => count + 1);
      onChanged();
    } catch (error) {
      toast({ tone: 'danger', title: failure, description: explain(error, 'The request failed.') });
    } finally {
      setBusy(false);
    }
  };
  const rescan = () =>
    void run(
      async () => {
        const found = await client.detectProject(project.id);
        toast({ tone: 'info', title: `Found ${String(found)} command${found === 1 ? '' : 's'}` });
      },
      'Repository re-scanned',
      'Could not re-scan the repository',
    );
  const forms = { project, client, busy, run };

  return (
    <li
      className="grid gap-3 border-b border-border py-4 last:border-b-0"
      data-testid={`project-${project.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <UserText className="truncate font-medium text-fg">{project.name}</UserText>
          {project.repoPath === null ? (
            <span className="text-xs text-fg-muted">Cloned from git for each scan</span>
          ) : (
            <Bdi className="truncate font-mono text-xs text-fg-muted">{project.repoPath}</Bdi>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasToken ? <Badge variant="secondary">Token saved</Badge> : null}
          <RowActions
            project={project}
            who={who}
            busy={busy}
            mode={mode}
            toggle={(next) => setMode(mode === next ? 'view' : next)}
            onRescan={rescan}
          />
        </div>
      </div>
      {mode === 'rename' ? <RenameForm {...forms} /> : null}
      {mode === 'token' ? <TokenForm {...forms} hasToken={hasToken} /> : null}
      {mode === 'delete' ? <DeleteForm {...forms} /> : null}
    </li>
  );
}

export function ProjectsSettingsPage({
  health,
  client,
  qa,
}: {
  health: HealthClient;
  client: SettingsClient;
  qa: QaClient;
}): React.ReactElement {
  const [version, setVersion] = React.useState(0);
  const projects = useResource(() => qa.listProjects(), [qa, version]);
  const refresh = () => setVersion((count) => count + 1);
  return (
    <PageFrame data-testid="settings-projects">
      <PageHeader
        title="Projects"
        subtitle="The repositories Lupin analyses. Connect one to fill every dashboard."
      />
      <PageBody>
        <AccessGate health={health}>
          {(who) => (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Connected repositories">
                {projects.status === 'loading' ? (
                  <p role="status" className="text-sm text-fg-muted">
                    Reading projects…
                  </p>
                ) : projects.status === 'error' ? (
                  <p role="alert" className="text-sm text-danger">
                    {projects.message}
                  </p>
                ) : projects.value.length === 0 ? (
                  <p className="text-sm text-fg-muted" data-testid="no-projects">
                    No repository is connected yet. Connect one to see scores, gaps and runs.
                  </p>
                ) : (
                  <ul aria-label="Projects" className="grid">
                    {projects.value.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        client={client}
                        who={who}
                        onChanged={refresh}
                      />
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Connect a repository">
                {canOperate(who) ? (
                  <ConnectRepository client={client} onConnected={refresh} />
                ) : (
                  <AskAnAdmin who={who} />
                )}
              </Panel>
            </div>
          )}
        </AccessGate>
      </PageBody>
    </PageFrame>
  );
}

// ─── Quality gates ──────────────────────────────────────────────────────────

/** The rule in words, so a threshold is never just a number. */
export function describeGate(gate: Pick<QualityGate, 'passRateThreshold'>): string {
  const rate = gate.passRateThreshold;
  if (rate >= 100) return 'A run passes only when every test passes.';
  if (rate <= 0) return 'Every run passes, whatever its tests do.';
  return `A run passes when at least ${String(rate)}% of its tests pass.`;
}

function GateRow({
  gate,
  client,
  canEdit,
  sharedNote,
  onChanged,
}: {
  gate: QualityGate;
  client: SettingsClient;
  canEdit: boolean;
  /** Say who can change a shared gate: shown to an admin who cannot, never to a viewer. */
  sharedNote: boolean;
  onChanged: () => void;
}): React.ReactElement {
  const toast = useToast();
  const id = React.useId();
  const [threshold, setThreshold] = React.useState(String(gate.passRateThreshold));
  const [busy, setBusy] = React.useState(false);
  const value = Number(threshold);
  const valid = threshold.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100;
  const changed = valid && value !== gate.passRateThreshold;
  async function act(action: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      toast({ tone: 'success', title: success });
      onChanged();
    } catch (error) {
      toast({
        tone: 'danger',
        title: 'The gate was not changed',
        description: explain(error, 'The request failed.'),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <li
      className="grid gap-2 border-b border-border py-4 last:border-b-0"
      data-testid={`gate-${gate.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <UserText className="font-medium text-fg">
          {gate.id === 'global' ? 'Default gate' : gate.name}
        </UserText>
        <span className="text-sm text-fg-muted">
          {describeGate({ passRateThreshold: valid ? value : gate.passRateThreshold })}
        </span>
      </div>
      {canEdit ? (
        <form
          aria-label={`Edit ${gate.name}`}
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              () => client.updateGate(gate.id, { passRateThreshold: value }),
              'Gate updated',
            );
          }}
        >
          <Input
            id={`${id}-rate`}
            label="Minimum pass rate (%)"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={threshold}
            error={valid ? undefined : 'Use a number from 0 to 100.'}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <Button type="submit" size="sm" loading={busy} disabled={!changed}>
            Save
          </Button>
          {gate.id === 'global' ? null : (
            <ConfirmAction
              label="Remove"
              title={`Remove the gate ${gate.name}?`}
              consequence="Its threshold no longer applies; the default gate's does."
              onConfirm={() => act(() => client.deleteGate(gate.id), 'Gate removed')}
            />
          )}
        </form>
      ) : gate.scope !== 'workspace' && sharedNote ? (
        <p className="text-sm text-fg-muted">
          Every workspace shares this gate. An installation admin can change it.
        </p>
      ) : null}
    </li>
  );
}

export function QualityGatesSettingsPage({
  health,
  client,
}: {
  health: HealthClient;
  client: SettingsClient;
}): React.ReactElement {
  const toast = useToast();
  const id = React.useId();
  const [version, setVersion] = React.useState(0);
  const gates = useResource(() => client.listGates(), [client, version]);
  const [name, setName] = React.useState('');
  const [rate, setRate] = React.useState('90');
  const refresh = () => setVersion((count) => count + 1);
  return (
    <PageFrame data-testid="settings-quality-gates">
      <PageHeader
        title="Quality gates"
        subtitle="What counts as a passing run. A run that misses its gate is marked failed."
      />
      <PageBody>
        <AccessGate health={health}>
          {(who) => (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Gates">
                {gates.status === 'loading' ? (
                  <p role="status" className="text-sm text-fg-muted">
                    Reading gates…
                  </p>
                ) : gates.status === 'error' ? (
                  <p role="alert" className="text-sm text-danger">
                    {gates.message}
                  </p>
                ) : (
                  <ul aria-label="Quality gates" className="grid">
                    {gates.value.map((gate) => (
                      <GateRow
                        key={`${gate.id}:${String(gate.passRateThreshold)}`}
                        gate={gate}
                        client={client}
                        // A shared gate is installation configuration (ledger MNT-170).
                        canEdit={
                          gate.scope === 'workspace'
                            ? canAdminister(who)
                            : canAdministerInstallation(who)
                        }
                        sharedNote={canAdminister(who)}
                        onChanged={refresh}
                      />
                    ))}
                  </ul>
                )}
              </Panel>
              {canAdministerInstallation(who) ? (
                <Panel title="Add a gate">
                  <form
                    aria-label="Add a gate"
                    className="grid gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      client
                        .createGate({ name: name.trim(), passRateThreshold: Number(rate) })
                        .then(() => {
                          toast({ tone: 'success', title: 'Gate added' });
                          setName('');
                          refresh();
                        })
                        .catch((error: unknown) =>
                          toast({
                            tone: 'danger',
                            title: 'Could not add the gate',
                            description: explain(error, 'The request failed.'),
                          }),
                        );
                    }}
                  >
                    <Input
                      id={`${id}-name`}
                      label="Name"
                      placeholder="Release gate"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <Input
                      id={`${id}-rate`}
                      label="Minimum pass rate (%)"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      helperText={describeGate({ passRateThreshold: Number(rate) })}
                      value={rate}
                      onChange={(event) => setRate(event.target.value)}
                    />
                    <div>
                      <Button type="submit" disabled={name.trim() === ''} className="min-h-10">
                        Add gate
                      </Button>
                    </div>
                  </form>
                </Panel>
              ) : null}
            </div>
          )}
        </AccessGate>
      </PageBody>
    </PageFrame>
  );
}
