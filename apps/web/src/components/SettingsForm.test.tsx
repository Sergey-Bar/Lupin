import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsApiError, type SettingsClient } from '../lib/settings-client.js';
import { health, read, settingsClient } from '../test-utils.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { SettingsForm, isEnvLocked } from './SettingsForm.js';
import { AiSettingsPage, IntegrationsSettingsPage, SessionsSettingsPage } from './SettingsPages.js';
import { ToastProvider } from './Toasts.js';

function form(
  client: SettingsClient,
  props: Partial<React.ComponentProps<typeof SettingsForm>> = {},
) {
  return render(
    <ToastProvider>
      <SettingsForm
        client={client}
        group="ai"
        title="AI provider"
        canEdit
        testKey="ai.gatewayUrl"
        {...props}
      />
    </ToastProvider>,
  );
}

describe('SettingsForm', () => {
  it('locks a field the environment sets, naming the variable', async () => {
    form(settingsClient());
    const field = await screen.findByLabelText('Gateway address');
    expect(field).toBeDisabled();
    expect(screen.getByTestId('locked-ai.gatewayUrl')).toHaveTextContent(
      'Set by environment (KILO_GATEWAY_URL)',
    );
  });

  it('shows a stored secret by its last four characters only, and offers Replace', async () => {
    const user = userEvent.setup();
    form(settingsClient());
    expect(await screen.findByTestId('secret-ai.apiKey')).toHaveTextContent('Saved · ending wxyz');
    expect(screen.getByText(/Saved .* by alice\./u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByLabelText('Gateway API key')).toHaveAttribute('type', 'password');
  });

  it('says what each field does, and keeps Save disabled until something changes', async () => {
    form(settingsClient());
    await screen.findByLabelText('Ollama address');
    expect(
      screen.getByText(/A local Ollama server to use instead of a gateway/u),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No changes' })).toBeDisabled();
  });

  it('saves only the changed field, with the keyboard alone', async () => {
    const user = userEvent.setup();
    const client = settingsClient();
    const onSaved = vi.fn();
    form(client, { onSaved });
    const ollama = await screen.findByLabelText('Ollama address');
    await user.click(ollama);
    await user.keyboard('http://ollama:11434');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(client.putSetting).toHaveBeenCalledWith('ai.ollamaBaseUrl', 'http://ollama:11434'),
    );
    expect(client.putSetting).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('Setting saved')).toBeInTheDocument();
  });

  it('saves a number as a number', async () => {
    const user = userEvent.setup();
    const client = settingsClient();
    render(
      <ToastProvider>
        <SettingsForm client={client} group="sessions-retention" title="Sessions" canEdit />
      </ToastProvider>,
    );
    const ttl = await screen.findByLabelText('Sign-in lasts (hours)');
    await user.clear(ttl);
    await user.type(ttl, '8');
    await user.click(screen.getByRole('button', { name: /Save/u }));
    await waitFor(() => expect(client.putSetting).toHaveBeenCalledWith('sessions.ttlHours', 8));
  });

  it('reverts a field that was emptied, rather than saving an empty value', async () => {
    const user = userEvent.setup();
    const client = settingsClient({
      listSettings: vi.fn(async () => [
        read('ai.ollamaBaseUrl', { source: 'ui', value: 'http://o:1' }),
      ]),
    });
    form(client);
    await user.clear(await screen.findByLabelText('Ollama address'));
    await user.click(screen.getByRole('button', { name: 'Save change' }));
    await waitFor(() => expect(client.revertSetting).toHaveBeenCalledWith('ai.ollamaBaseUrl'));
    expect(client.putSetting).not.toHaveBeenCalled();
  });

  it('shows the server’s reason and fix beside the field that failed', async () => {
    const user = userEvent.setup();
    const client = settingsClient({
      putSetting: vi.fn(async () => {
        throw new SettingsApiError(
          400,
          'Use an https:// address',
          'INVALID_SETTING',
          'Correct the highlighted value and save again.',
        );
      }),
    });
    form(client);
    await user.type(await screen.findByLabelText('Ollama address'), 'ftp://x');
    await user.click(screen.getByRole('button', { name: 'Save change' }));
    expect(await screen.findByTestId('error-ai.ollamaBaseUrl')).toHaveTextContent(
      'Use an https:// address Correct the highlighted value and save again.',
    );
    expect(screen.getByText('Some settings were not saved')).toBeInTheDocument();
  });

  it('tests the connection and announces the result', async () => {
    const user = userEvent.setup();
    const client = settingsClient();
    form(client);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connected: 3 models available.')).toBeInTheDocument();
    expect(client.testSetting).toHaveBeenCalledWith('ai.gatewayUrl', 'https://kilo.test');
  });

  it('turns a test that cannot run into a sentence', async () => {
    const user = userEvent.setup();
    form(settingsClient({ testSetting: vi.fn(async () => Promise.reject(new Error('offline'))) }));
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('The test could not run.')).toBeInTheDocument();
  });

  it('shows the fields read-only to a workspace admin, saying who can change them', async () => {
    form(settingsClient(), { canEdit: false });
    expect(await screen.findByRole('note')).toHaveTextContent(
      'only an installation admin can change them',
    );
    expect(screen.getByLabelText('Ollama address')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save|No changes/u })).toBeNull();
  });

  it('says so when settings cannot be read', async () => {
    form(
      settingsClient({
        listSettings: vi.fn(async () =>
          Promise.reject(Object.assign(new Error('x'), { detail: 'API down' })),
        ),
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Settings could not be read: API down',
    );
  });

  it('hands the changed values to a draft instead of saving them', async () => {
    const user = userEvent.setup();
    const onSubmitValues = vi.fn(async () => undefined);
    const client = settingsClient();
    form(client, { onSubmitValues, submitLabel: 'Save as draft' });
    await user.type(await screen.findByLabelText('Ollama address'), 'http://o:1');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(onSubmitValues).toHaveBeenCalledWith({ 'ai.ollamaBaseUrl': 'http://o:1' }),
    );
    expect(client.putSetting).not.toHaveBeenCalled();
  });

  it('has no blocking accessibility violations', async () => {
    const { container } = form(settingsClient());
    await screen.findByLabelText('Ollama address');
    await expectNoBlockingAxeViolations(container);
  });

  it('knows an environment lock when it sees one', () => {
    expect(isEnvLocked(new SettingsApiError(409, 'x', 'ENV_LOCKED', null))).toBe(true);
    expect(isEnvLocked(new Error('x'))).toBe(false);
  });
});

describe('installation settings pages', () => {
  it.each([
    ['AI provider', AiSettingsPage],
    ['Integrations', IntegrationsSettingsPage],
    ['Sessions & retention', SessionsSettingsPage],
  ] as const)(
    '%s draws its form for an installation admin, without accessibility violations',
    async (title, Page) => {
      const { container } = render(
        <ToastProvider>
          <Page health={health()} client={settingsClient()} />
        </ToastProvider>,
      );
      expect(await screen.findByRole('form', { name: title })).toBeInTheDocument();
      await expectNoBlockingAxeViolations(container);
    },
  );

  it('asks an operator to find an admin instead of drawing a form', async () => {
    render(
      <ToastProvider>
        <AiSettingsPage
          health={health({ role: 'operator', actor: 'token:o', source: 'token' })}
          client={settingsClient()}
        />
      </ToastProvider>,
    );
    expect(await screen.findByTestId('ask-an-admin')).toHaveTextContent(
      'You have the operator role here.',
    );
  });

  it('shows a workspace admin the fields read-only', async () => {
    render(
      <ToastProvider>
        <AiSettingsPage
          health={health({ actor: 'token:a', source: 'token' })}
          client={settingsClient()}
        />
      </ToastProvider>,
    );
    const formElement = await screen.findByRole('form', { name: 'AI provider' });
    expect(within(formElement).getByRole('note')).toBeInTheDocument();
  });
});

describe('SettingsForm controls by kind', () => {
  it('saves a role from its select and a switch as a boolean, and reports a draft that was refused', async () => {
    const user = userEvent.setup();
    const onSubmitValues = vi.fn(async () => {
      throw new SettingsApiError(
        409,
        'You would lose admin access.',
        'WOULD_LOCK_OUT',
        'Add a rule that keeps you an admin.',
      );
    });
    const client = settingsClient({
      listSettings: vi.fn(async () => [
        read('identity.oidcDefaultRole', { source: 'default', value: 'viewer' }),
        read('identity.ssoEnforced', { source: 'default', value: false }),
      ]),
    });
    render(
      <ToastProvider>
        <SettingsForm
          client={client}
          group="identity"
          title="Sign-in"
          canEdit
          onSubmitValues={onSubmitValues}
          submitLabel="Save as draft"
        />
      </ToastProvider>,
    );
    await user.selectOptions(await screen.findByLabelText('Role for everyone else'), 'none');
    await user.click(screen.getByLabelText('Require single sign-on'));
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(onSubmitValues).toHaveBeenCalledWith({
        'identity.oidcDefaultRole': 'none',
        'identity.ssoEnforced': true,
      }),
    );
    expect(
      await screen.findByText('You would lose admin access. Add a rule that keeps you an admin.'),
    ).toBeInTheDocument();
  });
});

describe('the GitHub App panel', () => {
  // Assembled at runtime: a PEM-shaped literal is what the secret scanners look for.
  const PEM = ['-----BEGIN PRIVATE ', 'KEY-----\nabc\n-----END PRIVATE ', 'KEY-----'].join('');

  it('lets an admin paste the App ID and key, sends them once, and never shows the key again', async () => {
    const user = userEvent.setup();
    let set = false;
    const client = settingsClient({
      githubAppState: vi.fn(async () => set),
      putGitHubApp: vi.fn(async () => {
        set = true;
      }),
    });
    render(
      <ToastProvider>
        <IntegrationsSettingsPage health={health()} client={client} />
      </ToastProvider>,
    );
    const panel = await screen.findByTestId('github-app');
    expect(await within(panel).findByText('Not set')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('App ID'), '42');
    await user.type(within(panel).getByLabelText('Private key (.pem)'), PEM);
    await user.click(within(panel).getByRole('button', { name: 'Save the app' }));
    expect(client.putGitHubApp).toHaveBeenCalledWith({ appId: '42', privateKey: PEM });
    expect(await within(panel).findByText('Connected')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Private key (.pem)')).toHaveValue('');
    expect(within(panel).getByRole('button', { name: 'Replace the app' })).toBeInTheDocument();
  });

  it('is not drawn for an operator, who is asked to find an admin', async () => {
    render(
      <ToastProvider>
        <IntegrationsSettingsPage
          health={health({ role: 'operator', actor: 'token:o', source: 'token' })}
          client={settingsClient()}
        />
      </ToastProvider>,
    );
    expect(await screen.findByTestId('ask-an-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('github-app')).toBeNull();
  });
});
