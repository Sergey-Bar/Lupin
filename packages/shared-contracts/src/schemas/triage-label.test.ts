import { describe, expect, it } from 'vitest';
import { TriageLabelBodySchema } from './test-reports.js';

describe('a known failure needs an issue or a reason (plan task 12)', () => {
  const signature = 'timeout <n>ms exceeded';
  it.each([
    [{ signature, category: 'known-issue' }, false],
    [{ signature, category: 'known-issue', issueUrl: null, reason: null }, false],
    [{ signature, category: 'known-issue', reason: 'the database restarts nightly' }, true],
    [{ signature, category: 'known-issue', issueUrl: 'https://tracker.example/T-1' }, true],
    [{ signature, category: 'environment' }, true],
    [{ signature, category: 'product', reason: '   ' }, false],
  ])('%j parses: %s', (body, valid) => {
    expect(TriageLabelBodySchema.safeParse(body).success).toBe(valid);
  });
});
