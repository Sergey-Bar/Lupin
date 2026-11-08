import React from 'react';
import { Button, CircleCheck, Input } from '@lupin/ui';
import {
  explain,
  nameFromSource,
  slugFor,
  type RegisteredProject,
  type SettingsClient,
} from '../lib/settings-client.js';
import { Segmented } from './kit.js';
import { UserText } from './Bidi.js';

/**
 * "Point Lupin at a repository", as a form.
 *
 * Two ways in, named the way a person thinks of them rather than by the API's field names: a
 * folder on the machine the runner uses, or a git repository the runner clones. The name fills
 * itself in from the path or URL, so the shortest path is one field and one button. After it
 * connects, the result says what was found — the detected commands — so the person sees the
 * scan worked before they leave the step.
 */
type Source = 'folder' | 'git';

const SOURCES: ReadonlyArray<{ value: Source; label: string }> = [
  { value: 'folder', label: 'A folder on this machine' },
  { value: 'git', label: 'A git repository' },
];

export function ConnectRepository({
  client,
  onConnected,
  submitLabel = 'Connect repository',
}: {
  client: SettingsClient;
  onConnected: (project: RegisteredProject) => void;
  submitLabel?: string;
}): React.ReactElement {
  const id = React.useId();
  const [source, setSource] = React.useState<Source>('folder');
  const [location, setLocation] = React.useState('');
  const [name, setName] = React.useState('');
  const [branch, setBranch] = React.useState('');
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState<RegisteredProject | null>(null);

  const suggested = nameFromSource(location);
  const effectiveName = name.trim() || suggested;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (location.trim() === '') {
      setError(source === 'folder' ? 'Enter the folder path.' : 'Enter the repository URL.');
      return;
    }
    if (effectiveName === '') {
      setError('Give the project a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = { name: effectiveName, slug: slugFor(effectiveName) };
      const project = await client.registerProject(
        source === 'folder'
          ? { ...base, repoPath: location.trim() }
          : {
              ...base,
              gitUrl: location.trim(),
              ...(branch.trim() === '' ? {} : { defaultBranch: branch.trim() }),
              ...(token.trim() === '' ? {} : { token: token.trim() }),
            },
      );
      setConnected(project);
      setToken('');
      onConnected(project);
    } catch (failure) {
      setError(explain(failure, 'The repository could not be connected.'));
    } finally {
      setBusy(false);
    }
  }

  if (connected !== null) {
    const count = connected.commands.length;
    return (
      <div
        role="status"
        className="grid gap-2 rounded-md border border-border bg-surface p-4"
        data-testid="repository-connected"
      >
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <CircleCheck aria-hidden className="size-4 text-success" />
          <span>
            Connected <UserText>{connected.project.name}</UserText>.
          </span>
        </p>
        <p className="text-sm text-fg-muted">
          {count === 0
            ? 'No test commands were detected yet. You can still upload results from CI.'
            : `Found ${String(count)} command${count === 1 ? '' : 's'} Lupin can run: ${connected.commands
                .slice(0, 3)
                .map((command) => command.label)
                .join(', ')}${count > 3 ? ', …' : ''}.`}
        </p>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setConnected(null)}>
            Connect another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      aria-label="Connect a repository"
      className="grid gap-4"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <Segmented<Source>
        label="Where is the code?"
        options={SOURCES}
        value={source}
        onChange={(next) => {
          setSource(next);
          setError(null);
        }}
      />
      {source === 'folder' ? (
        <Input
          id={`${id}-path`}
          label="Folder path"
          placeholder="/home/you/code/shop"
          helperText="The full path on the machine the runner uses. Lupin reads it; it never changes your files."
          value={location}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setLocation(event.target.value)}
        />
      ) : (
        <>
          <Input
            id={`${id}-url`}
            label="Repository URL"
            placeholder="https://github.com/acme/shop.git"
            helperText="An https or ssh address. The runner clones it for each scan."
            value={location}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setLocation(event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id={`${id}-branch`}
              label="Default branch (optional)"
              placeholder="main"
              value={branch}
              autoComplete="off"
              onChange={(event) => setBranch(event.target.value)}
            />
            <Input
              id={`${id}-token`}
              label="Access token (private repositories only)"
              type="password"
              helperText="Stored encrypted. Read-only access is enough."
              value={token}
              autoComplete="off"
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
        </>
      )}
      <Input
        id={`${id}-name`}
        label="Project name"
        placeholder={suggested === '' ? 'Shop' : suggested}
        helperText={
          suggested === ''
            ? 'How the project is shown everywhere in Lupin.'
            : `Leave empty to use “${suggested}”.`
        }
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {error === null ? null : (
        <p role="alert" className="text-sm text-danger" data-testid="connect-error">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" loading={busy} className="min-h-10">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
