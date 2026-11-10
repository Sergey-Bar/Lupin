import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GithubPullItem } from '@lupin/shared-contracts';
import { DeliveryArea } from './DeliveryArea.js';
import { expectOnePrimary } from '../test-utils.js';

const pull = {
  id: 'a',
  projectId: 'proj',
  projectName: 'Lupin',
  repository: 'acme/shop',
  number: 42,
  title: 'Express checkout',
  author: 'dev',
  state: 'open',
  draft: false,
  htmlUrl: null,
  headBranch: null,
  baseBranch: null,
  labels: [],
  reviewDecision: null,
  checksState: 'failure',
  mergeableState: null,
  requestedReviewers: [],
  openedAt: '2026-11-08T00:00:00.000Z',
  lastActivityAt: '2026-11-09T00:00:00.000Z',
  additions: 1,
  deletions: 1,
  headSha: null,
} as unknown as GithubPullItem;

describe('DeliveryArea', () => {
  it('opens on the same status band as Runs and Tests once the pull requests are read', async () => {
    const listPulls = vi.fn(async () => ({ items: [pull], nextCursor: null }));
    render(<DeliveryArea listPulls={listPulls} details={<p>full list</p>} navigate={vi.fn()} />);
    const band = await screen.findByRole('region', { name: 'Failing' });
    expect(band).toHaveTextContent('1 pull request is stuck.');
    expect(screen.queryByTestId('area-verdict')).toBeNull();
  });
  it('draws at most one solid primary button on the screen', async () => {
    const listPulls = vi.fn(async () => ({ items: [pull], nextCursor: null }));
    render(<DeliveryArea listPulls={listPulls} details={<p>full list</p>} navigate={vi.fn()} />);
    await screen.findByTestId(/^area-item-/u);
    expect(expectOnePrimary(document.body).length).toBeLessThanOrEqual(1);
  });

  it('leads with the stuck pull requests, and keeps the full list under Details', async () => {
    const listPulls = vi.fn(async () => ({ items: [pull], nextCursor: null }));
    render(<DeliveryArea listPulls={listPulls} details={<p>full list</p>} navigate={vi.fn()} />);
    expect(await screen.findByRole('region', { name: 'Failing' })).toHaveTextContent(
      '1 pull request is stuck.',
    );
    expect(screen.getByTestId('area-item-pull-a')).toHaveTextContent(
      'PR #42 is blocked by failing checks',
    );
    expect(screen.getByTestId('area-details')).toHaveTextContent('full list');
  });

  it('says GitHub is not connected yet, rather than an error, on a bare not found', async () => {
    const listPulls = vi.fn(async () => Promise.reject(new Error('not found')));
    render(<DeliveryArea listPulls={listPulls} details={<p>full list</p>} navigate={vi.fn()} />);
    expect(await screen.findByTestId('area-verdict')).toHaveTextContent(
      'GitHub is not connected yet.',
    );
  });
  it('does not say all clear under a read that failed', async () => {
    const listPulls = vi.fn(async () => Promise.reject(new Error('HTTP 502')));
    render(<DeliveryArea listPulls={listPulls} details={<p>full list</p>} navigate={vi.fn()} />);
    expect(await screen.findByTestId('area-verdict')).toHaveTextContent(
      "Could not read the pull requests: Lupin's server isn't answering right now.",
    );
    expect(screen.getByTestId('area-clear')).not.toHaveTextContent('No pull request needs you');
  });
  it('does not claim nothing is stuck when there are no pull requests to check', async () => {
    const listPulls = vi.fn(async () => ({ items: [], nextCursor: null }));
    render(<DeliveryArea listPulls={listPulls} details={<p>full list</p>} navigate={vi.fn()} />);
    expect(await screen.findByTestId('area-verdict')).toHaveTextContent(
      'No open pull requests yet. Connect GitHub in Settings to watch them here.',
    );
  });
});
