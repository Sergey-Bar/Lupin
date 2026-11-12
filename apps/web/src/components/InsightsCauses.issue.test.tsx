import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IssueLink } from '@lupin/shared-contracts';
import { FailureClustersPanel } from './InsightsCauses.js';
import { ToastProvider } from './Toasts.js';

/** An issue from a failure cause, and the same issue on every later occurrence (Wave 1 task 3). */
const cluster = (signature: string, message: string) => ({
  signature,
  errorType: null,
  sampleMessage: message,
  count: 3,
  tests: ['checkout › pays'],
  branches: ['main'],
  runs: 2,
  firstSeen: '2026-11-09T00:00:00.000Z',
  lastSeen: '2026-11-10T00:00:00.000Z',
});
const CLUSTERS = {
  clusters: [cluster('sig-filed', 'already filed'), cluster('sig-new', 'never filed')],
  totals: { failures: 6, causes: 2 },
  summary: '6 failures, 2 causes',
};
const PROJECT = '11111111-1111-4111-8111-111111111111';
const link = (key: string, created: boolean): IssueLink => ({
  id: key,
  projectId: PROJECT,
  sourceKind: 'cluster',
  sourceKey: 'hash',
  target: 'jira',
  key,
  url: `https://acme.atlassian.net/browse/${key}`,
  created,
  createdBy: 'token:operator',
  createdAt: '2026-11-10T00:00:00.000Z',
});

describe('an issue from a failure cause', () => {
  it('shows the issue a cause already has, and opens one for a cause that has none', async () => {
    const user = userEvent.setup();
    const qa = {
      clusterIssues: vi.fn(async () => ({ 'sig-filed': link('ACME-7', false) })),
      openClusterIssue: vi.fn(async () => link('ACME-8', true)),
    };
    render(
      <ToastProvider>
        <FailureClustersPanel
          clusters={CLUSTERS as never}
          issueTracking={{ projectId: PROJECT, qa }}
        />
      </ToastProvider>,
    );
    const [filed, fresh] = screen.getAllByTestId('failure-cluster') as [HTMLElement, HTMLElement];
    expect(await within(filed).findByRole('link', { name: 'ACME-7' })).toHaveAttribute(
      'href',
      'https://acme.atlassian.net/browse/ACME-7',
    );
    expect(qa.clusterIssues).toHaveBeenCalledWith(PROJECT, ['sig-filed', 'sig-new']);
    expect(within(filed).queryByRole('button', { name: 'Jira issue' })).toBeNull();

    await user.click(within(fresh).getByRole('button', { name: 'Jira issue' }));
    await waitFor(() =>
      expect(qa.openClusterIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT,
          target: 'jira',
          signature: 'sig-new',
          sampleMessage: 'never filed',
          tests: ['checkout › pays'],
        }),
      ),
    );
    expect(await within(fresh).findByRole('link', { name: 'ACME-8' })).toBeInTheDocument();
  });

  it('says why the tracker refused, and keeps offering the issue', async () => {
    const user = userEvent.setup();
    const qa = {
      clusterIssues: vi.fn(async () => ({})),
      openClusterIssue: vi.fn(async () => {
        throw Object.assign(new Error('503'), { detail: 'This project has no issue tracker' });
      }),
    };
    render(
      <ToastProvider>
        <FailureClustersPanel
          clusters={CLUSTERS as never}
          issueTracking={{ projectId: PROJECT, qa }}
        />
      </ToastProvider>,
    );
    const [first] = screen.getAllByTestId('failure-cluster') as [HTMLElement];
    await user.click(within(first).getByRole('button', { name: 'GitHub issue' }));
    expect(await screen.findByText('No issue was opened')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'GitHub issue' })).toBeEnabled();
  });

  it('still offers a new issue for each cause when the lookup fails', async () => {
    const qa = {
      clusterIssues: vi.fn(async () => {
        throw new Error('offline');
      }),
      openClusterIssue: vi.fn(),
    };
    render(
      <ToastProvider>
        <FailureClustersPanel
          clusters={CLUSTERS as never}
          issueTracking={{ projectId: PROJECT, qa }}
        />
      </ToastProvider>,
    );
    await waitFor(() => expect(qa.clusterIssues).toHaveBeenCalled());
    const [first] = screen.getAllByTestId('failure-cluster') as [HTMLElement];
    expect(within(first).getByRole('button', { name: 'GitHub issue' })).toBeEnabled();
    expect(within(first).queryByRole('link')).toBeNull();
  });
});
