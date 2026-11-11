import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Onboarding, OnboardingStep } from '@lupin/shared-contracts';
import type { NotificationsClient } from '../lib/notifications-client.js';
import type { QaClient } from '../lib/qa-client.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { health, settingsClient } from '../test-utils.js';
import { SetupChecklist } from './SetupChecklist.js';
import { SETUP_LATER_KEY, SetupPage, type SetupClients } from './SetupWizard.js';
import { ToastProvider } from './Toasts.js';

const META: Record<OnboardingStep['id'], Pick<OnboardingStep, 'title' | 'who' | 'href'>> = {
  workspace: { title: 'Create your workspace', who: 'admin', href: '/dashboard/settings/members' },
  repository: {
    title: 'Connect a repository',
    who: 'operator',
    href: '/dashboard/settings/projects',
  },
  ai: { title: 'Connect an AI provider', who: 'admin', href: '/dashboard/settings/ai' },
  notifications: {
    title: 'Choose where reports go',
    who: 'admin',
    href: '/dashboard/settings/reports',
  },
  teammates: { title: 'Invite your teammates', who: 'admin', href: '/dashboard/settings/members' },
  'first-run': { title: 'Run your first check', who: 'operator', href: '/dashboard/runner' },
};

function onboarding(
  states: Partial<Record<OnboardingStep['id'], OnboardingStep['state']>> = {},
  dismissed = false,
): Onboarding {
  const steps = (Object.keys(META) as Array<OnboardingStep['id']>).map((id) => ({
    id,
    ...META[id],
    state: states[id] ?? (id === 'workspace' ? 'done' : 'todo'),
  }));
  return { steps, done: steps.filter((step) => step.state === 'done').length, total: 6, dismissed };
}

const SHOP = {
  id: 'p1',
  workspaceId: 'ws-1',
  name: 'Shop',
  slug: 'shop',
  repoPath: '/s',
  detectorVersion: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function clients(
  overrides: Parameters<typeof settingsClient>[0] = {},
  role: 'viewer' | 'admin' = 'admin',
): SetupClients {
  let state = onboarding();
  return {
    health: health({ role }),
    settings: settingsClient({
      getOnboarding: vi.fn(async () => state),
      dismissStep: vi.fn(async (step: string) => {
        state = onboarding({
          ...Object.fromEntries(state.steps.map((s) => [s.id, s.state])),
          [step]: 'skipped',
        });
        return state;
      }),
      registerProject: vi.fn(async () => {
        state = onboarding({ repository: 'done' });
        return {
          project: { id: 'p1', name: 'Shop' },
          commands: [{ id: 'node.test', label: 'npm test' }],
        };
      }),
      ...overrides,
    }),
    qa: { listProjects: vi.fn(async () => [SHOP]) } as unknown as QaClient,
    notifications: { createChannel: vi.fn(async () => ({})) } as unknown as NotificationsClient,
  };
}

function wizard(setup: SetupClients) {
  return render(
    <ToastProvider>
      <SetupPage clients={setup} />
    </ToastProvider>,
  );
}

describe('the setup wizard', () => {
  it('resumes at the first step not done, and marks where the reader is', async () => {
    const { container } = wizard(clients());
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Connect a repository' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('setup-progress')).toHaveTextContent('1 of 6 done');
    const current = within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
      current: 'step',
    });
    expect(current).toHaveTextContent('Connect a repository');
    await expectNoBlockingAxeViolations(container);
  });

  it('orders the steps toward a first result: repository, first run, then the optional ones', async () => {
    wizard(clients());
    await screen.findByRole('heading', { level: 2, name: 'Connect a repository' });
    const order = within(screen.getByRole('list', { name: 'Setup steps' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('data-step'));
    expect(order).toEqual([
      'workspace',
      'repository',
      'first-run',
      'ai',
      'notifications',
      'teammates',
    ]);
  });

  it('opens full-screen, outside the app frame, with a way out that is remembered', async () => {
    localStorage.removeItem(SETUP_LATER_KEY);
    const user = userEvent.setup();
    wizard(clients());
    await screen.findByRole('heading', { level: 2, name: 'Connect a repository' });
    expect(screen.getByRole('heading', { level: 1, name: 'Set up Lupin' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    const later = screen.getByRole('link', { name: 'Do this later' });
    expect(later).toHaveAttribute('href', '/dashboard/now');
    await user.click(later);
    expect(localStorage.getItem(SETUP_LATER_KEY)).toBe('1');
  });

  it('keeps Back and Skip in a footer that stays on screen, with Skip as a quiet text button', async () => {
    wizard(clients());
    await screen.findByRole('heading', { level: 2, name: 'Connect a repository' });
    const actions = screen.getByTestId('setup-actions');
    expect(actions).toHaveClass('sticky', 'bottom-0', 'bg-surface');
    const skip = within(actions).getByRole('button', { name: 'Skip for now' });
    expect(skip).toHaveClass('bg-transparent', 'text-fg-muted');
    expect(skip).not.toHaveClass('border');
  });

  it('connects a repository, then continues, moving focus to the next step', async () => {
    const user = userEvent.setup();
    wizard(clients());
    await user.type(await screen.findByLabelText('Folder path'), '/src/shop');
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    expect(await screen.findByText('Found 1 command Lupin can run: npm test.')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Run your first check',
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('skips a step, records it, and goes back on request', async () => {
    const user = userEvent.setup();
    const setup = clients();
    wizard(setup);
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(setup.settings.dismissStep).toHaveBeenCalledWith('repository'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Run your first check' }),
    ).toBeInTheDocument();
    // The step strip says which steps were skipped.
    expect(
      await within(screen.getByRole('list', { name: 'Setup steps' })).findByRole('button', {
        name: 'Connect a repository, skipped',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Connect a repository' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('adds the Lupin inbox in one press on the reports step', async () => {
    const user = userEvent.setup();
    const setup = clients();
    wizard(setup);
    await screen.findByRole('heading', { level: 2, name: 'Connect a repository' });
    await user.click(
      within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
        name: /Choose where reports go/u,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Use the Lupin inbox' }));
    await waitFor(() =>
      expect(setup.notifications.createChannel).toHaveBeenCalledWith({
        kind: 'inbox',
        name: 'Lupin inbox',
        settings: {},
      }),
    );
  });

  it('hands the first run to the runner, and ends with what is left', async () => {
    const user = userEvent.setup();
    wizard(clients());
    await screen.findByRole('heading', { level: 2, name: 'Connect a repository' });
    await user.click(
      within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
        name: /Run your first check/u,
      }),
    );
    expect(await screen.findByRole('link', { name: 'Open the runner' })).toHaveAttribute(
      'href',
      '/dashboard/runner',
    );
    // The first run comes straight after the repository, so AI and reports wait until a result
    // has landed: what a reader came for, first.
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Connect an AI provider' }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
        name: /Invite your teammates/u,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    const finished = await screen.findByTestId('setup-finished');
    expect(
      within(finished).getByRole('heading', { name: 'You’re ready to go' }),
    ).toBeInTheDocument();
    expect(within(finished).getByRole('link', { name: 'Connect an AI provider' })).toHaveAttribute(
      'href',
      '/dashboard/settings/ai',
    );
  });

  it('says "You’re set up" when every step is done', async () => {
    const done = onboarding(Object.fromEntries(Object.keys(META).map((id) => [id, 'done'])));
    wizard(clients({ getOnboarding: vi.fn(async () => done) }));
    expect(await screen.findByRole('heading', { name: 'You’re set up' })).toBeInTheDocument();
  });

  it('tells a viewer who can do each step instead of offering forms', async () => {
    wizard(clients({}, 'viewer'));
    expect(
      await screen.findByText('Ask an operator or admin to connect a repository.'),
    ).toBeInTheDocument();
  });

  it('says so when setup cannot be read', async () => {
    wizard(
      clients({
        getOnboarding: vi.fn(async () =>
          Promise.reject(Object.assign(new Error('x'), { detail: 'API down' })),
        ),
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Setup could not be read: API down');
  });
});

describe('the cockpit checklist', () => {
  const source = (state: Onboarding, role: 'viewer' | 'admin' | null = 'admin') => ({
    load: vi.fn(async () => state),
    dismiss: vi.fn(async () => state),
    role: vi.fn(async () => role),
  });

  it('shows progress, the next step and the rest, and an admin can dismiss it', async () => {
    const user = userEvent.setup();
    const checklist = source(onboarding({ repository: 'done', ai: 'skipped' }));
    const { container } = render(<SetupChecklist source={checklist} />);
    expect(await screen.findByTestId('setup-checklist-progress')).toHaveTextContent(
      'Setup 2 of 6 · Next: connect an ai provider',
    );
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    expect(within(screen.getByTestId('checklist-ai')).getByRole('link')).toHaveTextContent(
      'Connect an AI provider (skipped)',
    );
    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      '/dashboard/setup',
    );
    await expectNoBlockingAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Dismiss the setup checklist' }));
    expect(checklist.dismiss).toHaveBeenCalled();
    expect(screen.queryByTestId('setup-checklist')).toBeNull();
  });

  it('takes one line on the home page, and folds the steps until asked', async () => {
    render(<SetupChecklist source={source(onboarding({ repository: 'done' }))} />);
    expect(await screen.findByTestId('setup-checklist-progress')).toHaveTextContent('Setup 2 of 6');
    const steps = screen.getByTestId('setup-checklist-steps');
    expect(steps.tagName).toBe('DETAILS');
    expect(steps).not.toHaveAttribute('open');
    // Not a second solid button: the focus card above owns the one primary action.
    expect(screen.getByRole('link', { name: 'Continue setup' })).not.toHaveClass(
      'bg-primary-gradient',
    );
  });

  it('lets focus mode put it away: setup is not the work', async () => {
    render(<SetupChecklist source={source(onboarding({ repository: 'done' }))} />);
    expect(await screen.findByTestId('setup-checklist')).toHaveAttribute(
      'data-chrome',
      'secondary',
    );
  });

  it('is read-only for a viewer, naming who can finish each step', async () => {
    render(<SetupChecklist source={source(onboarding(), 'viewer')} />);
    expect(await screen.findByTestId('checklist-ai')).toHaveTextContent(
      'Connect an AI provider — ask an admin',
    );
    expect(screen.queryByRole('link', { name: 'Continue setup' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss the setup checklist' })).toBeNull();
  });

  it('hides itself when every step is done or the card was dismissed', async () => {
    const all = onboarding(Object.fromEntries(Object.keys(META).map((id) => [id, 'done'])));
    const { container, rerender } = render(<SetupChecklist source={source(all)} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    rerender(<SetupChecklist source={source(onboarding({}, true))} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('the first-run step', () => {
  async function openFirstRun(setup: SetupClients) {
    const user = userEvent.setup();
    wizard(setup);
    await screen.findByRole('heading', { level: 2, name: /Connect a repository|Welcome/u });
    await user.click(
      within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
        name: /Run your first check/u,
      }),
    );
    return user;
  }

  it('asks for a repository first when none is connected', async () => {
    const setup = clients();
    setup.qa = { listProjects: vi.fn(async () => []) } as unknown as QaClient;
    await openFirstRun(setup);
    expect(
      await screen.findByText('Connect a repository first: go back to step 2.'),
    ).toBeInTheDocument();
  });

  it('says why the projects could not be read', async () => {
    const setup = clients();
    setup.qa = {
      listProjects: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { detail: 'Registry down' })),
      ),
    } as unknown as QaClient;
    await openFirstRun(setup);
    expect(await screen.findByText('Registry down')).toBeInTheDocument();
  });

  it('tells a viewer who can start the run, and moves on without recording a skip', async () => {
    const setup = clients({}, 'viewer');
    const user = await openFirstRun(setup);
    expect(
      await screen.findByText('Ask an operator or admin to start the first run.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    // It moves on to the next step, the first optional one.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Connect an AI provider' }),
    ).toBeInTheDocument();
    expect(setup.settings.dismissStep).not.toHaveBeenCalled();
  });

  it('says so when a skip cannot be recorded', async () => {
    const user = userEvent.setup();
    wizard(
      clients({
        dismissStep: vi.fn(async () =>
          Promise.reject(Object.assign(new Error('x'), { detail: 'Forbidden' })),
        ),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('Could not skip')).toBeInTheDocument();
  });

  it('reports an inbox that could not be added', async () => {
    const setup = clients();
    setup.notifications = {
      createChannel: vi.fn(async () =>
        Promise.reject(Object.assign(new Error('x'), { detail: 'No vault' })),
      ),
    } as unknown as NotificationsClient;
    const user = userEvent.setup();
    wizard(setup);
    await screen.findByRole('heading', { level: 2, name: 'Connect a repository' });
    await user.click(
      within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
        name: /Choose where reports go/u,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Use the Lupin inbox' }));
    expect(await screen.findByText('Could not add the inbox')).toBeInTheDocument();
  });
});
