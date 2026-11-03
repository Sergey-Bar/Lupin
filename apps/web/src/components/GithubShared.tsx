import React from 'react';
import { Select } from '@lupin/ui';
import type { GithubRepoItem } from '@lupin/shared-contracts';
import type { Resource } from '../hooks/useResource.js';

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
