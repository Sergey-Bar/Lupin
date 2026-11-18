import { describe, expect, it } from 'vitest';
import {
  syntheticAwsKeyId,
  syntheticGithubToken,
  syntheticPrivateKeyBlock,
  syntheticSlackToken,
} from '../test-support/synthetic-credentials.js';
import { normaliseFailure } from './reporter-persistence.js';

/**
 * REL-3: a test's failure message is stored and shown on the run page, the insights and the
 * reports. A CI log routinely prints a token (a failed `curl -H "Authorization: …"`, an env dump,
 * a stack trace with a connection string), so the message is redacted where it is stored — the
 * one rule both the event door and the upload door apply (`normaliseFailure`) — with the same
 * patterns `@lupin/reporter`'s `redactSecrets` applies to agent traces.
 */
describe('a failure message is stored without the secrets a CI log printed', () => {
  it.each([
    ['a GitHub token', syntheticGithubToken()],
    ['a Slack token', syntheticSlackToken()],
    ['an AWS key id', syntheticAwsKeyId()],
  ])('redacts %s', (_name, secret) => {
    const stored = normaliseFailure({
      message: `request failed: Authorization: Bearer ${secret} -> 401`,
    });
    expect(stored.errorMessage).not.toContain(secret);
    expect(stored.errorMessage).toContain('request failed');
  });

  it('redacts a private key block a stack trace printed', () => {
    // A whole block, header to footer, as a log prints one; assembled so no scanner reads a key.
    const block = [
      syntheticPrivateKeyBlock(),
      'Zm9vYmFy',
      ['-----END ', 'RSA ', 'PRIVATE KEY-----'].join(''),
    ].join('\n');
    const stored = normaliseFailure({
      message: `could not sign:\n${block}\nat sign (crypto.ts:4)`,
    });
    expect(stored.errorMessage).not.toContain('PRIVATE KEY');
    expect(stored.errorMessage).not.toContain('Zm9vYmFy');
    expect(stored.errorMessage).toContain('at sign (crypto.ts:4)');
  });

  it('leaves an ordinary assertion message exactly as it was', () => {
    const message = 'AssertionError: expected order 1042 total 10.00, received 9.90';
    expect(normaliseFailure({ message }).errorMessage).toBe(message);
  });
});
