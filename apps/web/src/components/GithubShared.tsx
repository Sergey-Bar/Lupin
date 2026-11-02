import React from 'react';
import { Badge, Select, type Timer } from '@lupin/ui';
import type { GithubRepoItem } from '@lupin/shared-contracts';
import type { Resource } from '../hooks/useResource.js';

/** A verdict as an icon and a word, never a colour alone. */
export function Verdict({
  entry,
}: {
  entry: {
    label: string;
    variant: 'success' | 'danger' | 'warning' | 'outline';
    Icon: typeof Timer;
  };
}): React.ReactElement {
  return (
    <Badge variant={entry.variant} className="gap-1 whitespace-nowrap">
      <entry.Icon size={12} aria-hidden="true" />
      {entry.label}
    </Badge>
  );
}

/** The repository filter every GitHub list shares. Names come from the repository overview. */
export function RepositoryFilter({
  id,
  repos,
  value,
  onChange,
}: {
  id: string;
  repos: Resource<{ items: GithubRepoItem[] }>;
  value: string;
  onChange: (projectId: string) => void;
}): React.ReactElement {
  return (
    <div className="w-56">
      <Select
        id={id}
        aria-label="Repository"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={[
          { value: '', label: 'All repositories' },
          ...(repos.status === 'ready'
            ? repos.value.items.map((repo) => ({ value: repo.projectId, label: repo.name }))
            : []),
        ]}
      />
    </div>
  );
}
