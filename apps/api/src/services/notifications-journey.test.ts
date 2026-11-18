import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@lupin/db';
import { createGitHubAdapter } from '@lupin/connectors-github';
import { jiraAdapter } from '@lupin/connectors-jira';
import { signalAdapter } from '@lupin/connectors-signal';
import { slackAdapter } from '@lupin/connectors-slack';
import { teamsAdapter } from '@lupin/connectors-teams';
import { telegramAdapter } from '@lupin/connectors-telegram';
import { whatsappAdapter } from '@lupin/connectors-whatsapp';
import type { CreateChannelBody } from '@lupin/shared-contracts';
import { useOutboundResolver } from '../http/outbound-guard.js';
import {
  FAKE_SIGNAL_BRIDGE,
  installConnectorFakes,
  type ConnectorFakes,
  type Platform,
} from '../test-support/connector-fakes.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import { createClusterIssue, setIssueTracker } from './issue-tracker-service.js';
import { createChannel, queueTestDelivery } from './notification-service.js';
import { createReportDispatcher } from './report-dispatcher.js';

/**
 * Release journey 5 (`docs/quality/release-journeys.json`, `notifications`): a report reaches
 * every chat platform, a failure cluster becomes a Jira issue, and the pull-request gate is a
 * GitHub commit status — each through the **production** adapter, vault and dispatcher, against
 * a fake that refuses what the platform's documentation says it refuses
 * (`test-support/connector-fakes.ts`, sources and read date beside each rule).
 *
 * This is the `fake-verified` level. A connector reaches `live-verified` only through the
 * opt-in `connectors-live` workflow against a real account.
 */
const VAULT = syntheticVaultSecret();
// The workspace the migrated test database seeds; channels and projects key onto it.
const WORKSPACE = 'ws-1';
// Assembled, never written whole: the secret scanners match the platforms' token shapes.
const SLACK_TOKEN = ['xoxb', '1111', '2222', 'fakefakefake'].join('-');
const TELEGRAM_TOKEN = ['123456', ':', 'AAH-fake_bot_token'].join('');
const WHATSAPP_TOKEN = ['EAAG', 'fakeGraphToken'].join('');
const JIRA_TOKEN = ['jira', 'fake', 'token'].join('-');
const GITHUB_TOKEN = ['ghp', 'fakefakefakefakefakefakefakefakefake'].join('_');

const CHANNELS: Record<Exclude<Platform, 'jira' | 'github'>, CreateChannelBody> = {
  slack: { kind: 'slack', name: 'QA', settings: { channel: 'C0123456' }, secret: SLACK_TOKEN },
  teams: {
    kind: 'teams',
    name: 'QA',
    settings: {},
    secret: 'https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi',
  },
  telegram: {
    kind: 'telegram',
    name: 'QA',
    settings: { chatId: '-1001234567' },
    secret: TELEGRAM_TOKEN,
  },
  whatsapp: {
    kind: 'whatsapp',
    name: 'QA',
    settings: {
      phoneNumberId: '1098765432',
      to: '15551234567',
      template: 'qa_report',
      language: 'en_US',
    },
    secret: WHATSAPP_TOKEN,
  },
  signal: {
    kind: 'signal',
    name: 'QA',
    settings: { number: '+15550001111', recipients: '+15550002222' },
    secret: FAKE_SIGNAL_BRIDGE,
  },
};

const ADAPTERS = {
  slack: slackAdapter,
  teams: teamsAdapter,
  telegram: telegramAdapter,
  whatsapp: whatsappAdapter,
  signal: signalAdapter,
};

let fakes: ConnectorFakes;
const closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  fakes = installConnectorFakes();
  // Every fake host resolves to a public documentation address, so the outbound guard judges
  // the URL rather than this machine's DNS; the Signal bridge is the one allowed private hop.
  useOutboundResolver(async () => ['93.184.216.34']);
});

afterEach(async () => {
  fakes.restore();
  useOutboundResolver();
  vi.useRealTimers();
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options = { db: db as never, workspaceId: WORKSPACE, vaultSecret: VAULT };
  const dispatcher = createReportDispatcher({
    db: db as never,
    vaultSecret: VAULT,
    adapters: ADAPTERS,
    link: 'https://lupin.example/dashboard/now',
    log: () => undefined,
  });
  return { db, options, dispatcher };
}

describe('a report reaches every chat platform, as each platform documents it', () => {
  it.each(Object.keys(CHANNELS) as Array<keyof typeof CHANNELS>)(
    '%s receives the report, and the delivery is recorded as sent',
    async (platform) => {
      const { options, dispatcher } = await setup();
      const channel = await createChannel(options, CHANNELS[platform]);
      await queueTestDelivery(options, channel.id);
      const outcomes = await dispatcher.runOnce();
      expect(outcomes).toMatchObject([{ status: 'sent', errorCode: null }]);
      const received = fakes.requests.filter((request) => request.platform === platform);
      expect(received.length).toBeGreaterThan(0);
      // The secret travels where the platform expects it, and nowhere else.
      const last = received.at(-1);
      if (platform === 'slack')
        expect(last?.headers['authorization']).toBe(`Bearer ${SLACK_TOKEN}`);
      if (platform === 'whatsapp')
        expect(last?.headers['authorization']).toBe(`Bearer ${WHATSAPP_TOKEN}`);
      if (platform === 'telegram') expect(last?.url).toContain(`/bot${TELEGRAM_TOKEN}/`);
      for (const request of received) {
        expect(JSON.stringify(request.body ?? '')).not.toContain(VAULT);
      }
    },
  );

  it('keeps the WhatsApp template parameter on one line, which the platform requires', async () => {
    const { options, dispatcher } = await setup();
    const channel = await createChannel(options, CHANNELS.whatsapp);
    await queueTestDelivery(options, channel.id);
    await dispatcher.runOnce();
    const body = fakes.requests.find((request) => request.platform === 'whatsapp')?.body as {
      template: { components: Array<{ parameters: Array<{ text: string }> }> };
    };
    expect(body.template.components[0]?.parameters[0]?.text).not.toMatch(/\n/u);
  });

  it('never posts twice after a 5xx, which may have been delivered', async () => {
    const { options, dispatcher } = await setup();
    const channel = await createChannel(options, CHANNELS.slack);
    await queueTestDelivery(options, channel.id);
    fakes.script('slack', 'server-error');
    const first = await dispatcher.runOnce();
    // A 5xx after a post may have delivered it, so the dispatcher must not post twice.
    expect(fakes.requests.filter((request) => request.platform === 'slack')).toHaveLength(1);
    expect(first[0]?.status).not.toBe('sent');
  });

  it('refuses a request the platform would refuse, so a broken adapter cannot pass', async () => {
    // The harness is the claim, so it must be able to say no: a Slack post with no channel.
    const answer = await slackAdapter.execute(
      { operation: 'postMessage', input: { channel: '', text: 'x' } },
      SLACK_TOKEN,
    );
    expect(answer.status).toBe('error');
  });
});

describe('a failure cluster becomes a Jira issue in the shape Jira Cloud accepts', () => {
  it('files the issue with an Atlassian Document description, and links it', async () => {
    const { db, options } = await setup();
    const [row] = await db
      .insert(schema.projects)
      .values({
        workspaceId: WORKSPACE,
        name: 'shop',
        slug: 'shop',
        defaultBranch: 'main',
        profile: {},
      })
      .returning({ id: schema.projects.id });
    const projectId = (row as { id: string }).id;
    await setIssueTracker(
      options,
      projectId,
      {
        kind: 'jira',
        baseUrl: 'https://acme.atlassian.net',
        projectKey: 'QA',
        issueType: 'Bug',
        token: JIRA_TOKEN,
      },
      'admin',
    );
    const link = await createClusterIssue(
      options,
      {
        jira: jiraAdapter,
        github: createGitHubAdapter(),
        detailsUrl: () => 'https://lupin.example/x',
      },
      {
        projectId,
        target: 'jira',
        signature: 'TimeoutError: page.click waiting for #pay',
        errorType: 'TimeoutError',
        sampleMessage: 'Timeout 30000ms exceeded.\nwaiting for locator("#pay")',
        tests: ['checkout › pays by card'],
        count: 12,
        runs: 4,
        branches: ['main'],
      },
      'operator',
    );
    expect(link).toMatchObject({ key: 'QA-1' });
    const sent = fakes.requests.find(
      (request) => request.platform === 'jira' && request.method === 'POST',
    );
    expect(sent?.headers['authorization']).toBe(`Bearer ${JIRA_TOKEN}`);
    expect(sent?.body).toMatchObject({
      fields: {
        project: { key: 'QA' },
        issuetype: { name: 'Bug' },
        description: { type: 'doc', version: 1 },
      },
    });
  });
});

describe('the pull-request gate is a GitHub commit status GitHub accepts', () => {
  it('posts a valid state and a description within the 140-character limit', async () => {
    const github = createGitHubAdapter();
    const answer = await github.execute(
      {
        operation: 'createCommitStatus',
        input: {
          owner: 'acme',
          repo: 'shop',
          sha: 'abc1234def',
          state: 'failure',
          context: 'lupin/health',
          description: 'Grade D: 1 open secret in the repository',
        },
      },
      GITHUB_TOKEN,
    );
    expect(answer.status, JSON.stringify(answer)).toBe('ok');
    const sent = fakes.requests.find((request) => request.platform === 'github');
    expect(sent?.url).toBe('https://api.github.com/repos/acme/shop/statuses/abc1234def');
  });
});
