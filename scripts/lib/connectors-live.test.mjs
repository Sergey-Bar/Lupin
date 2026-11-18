import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROBES, exitCodeFor, runProbes } from './connectors-live.mjs';

/** @param {string} status */
const adapter = (status) => ({
  calls: /** @type {Array<{ operation: string, secret: string }>} */ ([]),
  /** @param {{ operation: string }} request @param {string} secret */
  async execute(request, secret) {
    this.calls.push({ operation: request.operation, secret });
    return status === 'ok' ? { status } : { status, error: { code: 'refused' } };
  },
});

test('with no secrets every connector is not_configured, and that is not a failure', async () => {
  const results = await runProbes({}, {});
  assert.equal(results.length, PROBES.length + 1);
  assert.ok(results.every((entry) => entry.result === 'not_configured'));
  assert.equal(exitCodeFor(results), 0);
});

test('a configured connector runs its read, never a send, with its own secret', async () => {
  const slack = adapter('ok');
  const results = await runProbes({ slack }, { LUPIN_LIVE_SLACK_TOKEN: 'tok' });
  assert.deepEqual(slack.calls, [{ operation: 'authTest', secret: 'tok' }]);
  assert.equal(results.find((entry) => entry.id === 'slack')?.result, 'passed');
  for (const probe of PROBES) assert.doesNotMatch(probe.operation, /send|post|create/iu);
});

test('the harness refutes a wrong claim: a refused probe fails the run', async () => {
  const results = await runProbes(
    { telegram: adapter('error') },
    { LUPIN_LIVE_TELEGRAM_TOKEN: 't' },
  );
  assert.equal(results.find((entry) => entry.id === 'telegram')?.result, 'failed');
  assert.equal(exitCodeFor(results), 1);
});

test('a secret without its companion setting is not_configured, not a half-run probe', async () => {
  const github = adapter('ok');
  const results = await runProbes({ github }, { LUPIN_LIVE_GITHUB_TOKEN: 'g' });
  assert.equal(github.calls.length, 0);
  assert.match(
    results.find((entry) => entry.id === 'github')?.detail ?? '',
    /LUPIN_LIVE_GITHUB_REPO/u,
  );
});
