import React from 'react';
import { Button, Input } from '@lupin/ui';
import type { RegisteredProject } from '../lib/qa.js';
import type { SettingsClient } from '../lib/settings-client.js';
import type { RunAction } from './SettingsPages.js';

/**
 * A project's name and the branch Home judges its release on. Only what changed is sent, so a
 * rename never overwrites a branch Lupin detected from the checkout.
 */
export function RenameForm({
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
  const current = project.defaultBranch ?? '';
  const [branch, setBranch] = React.useState(current);
  const nextName = name.trim();
  const nextBranch = branch.trim();
  const changes = {
    ...(nextName !== '' && nextName !== project.name ? { name: nextName } : {}),
    ...(nextBranch !== '' && nextBranch !== current ? { defaultBranch: nextBranch } : {}),
  };
  return (
    <form
      aria-label={`Rename ${project.name}`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => client.updateProject(project.id, changes),
          'Project saved',
          'Could not save the project',
        );
      }}
    >
      <Input
        id={`${id}-name`}
        label="New name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        id={`${id}-branch`}
        label="Release branch"
        placeholder="Detected from git"
        value={branch}
        onChange={(event) => setBranch(event.target.value)}
      />
      <Button type="submit" size="sm" loading={busy} disabled={Object.keys(changes).length === 0}>
        Save
      </Button>
    </form>
  );
}
