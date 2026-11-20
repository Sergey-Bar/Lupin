import React from 'react';
import type { RegisteredProject } from '../lib/qa.js';
import { Bdi, UserText } from './Bidi.js';
import { CopyButton } from './kit.js';

/** The project id a CI job sets as `LUPIN_PROJECT`, with a copy button. */
export function ProjectId({ id }: { id: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1 text-xs text-fg-muted">
      Project id <Bdi className="font-mono">{id}</Bdi>
      <CopyButton text={id} label="project id" />
    </span>
  );
}

/** A project's name, where its source is read from, and its id. */
export function ProjectSource({
  project,
}: {
  project: Pick<RegisteredProject, 'id' | 'name' | 'repoPath'>;
}): React.ReactElement {
  return (
    <div className="grid min-w-0 gap-0.5">
      <UserText className="truncate font-medium text-fg">{project.name}</UserText>
      {project.repoPath === null ? (
        <span className="text-xs text-fg-muted">Cloned from git for each scan</span>
      ) : (
        <Bdi className="truncate font-mono text-xs text-fg-muted">{project.repoPath}</Bdi>
      )}
      <ProjectId id={project.id} />
    </div>
  );
}
