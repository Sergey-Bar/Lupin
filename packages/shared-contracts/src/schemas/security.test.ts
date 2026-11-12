import { describe, expect, it } from 'vitest';
import {
  ZAP_DEFAULT_SPIDER_MINUTES,
  ZAP_MAX_SPIDER_MINUTES,
  SecurityScanInputSchema,
  ZapJobConfigurationSchema,
} from './security.js';

const VALID = { targetUrl: 'http://127.0.0.1:3000' };

describe('SecurityScanInputSchema', () => {
  it('accepts a target and the run-request fields, and the ceiling exactly', () => {
    const input = {
      ...VALID,
      spiderMinutes: ZAP_MAX_SPIDER_MINUTES,
      projectId: 'p',
      environmentId: 'e',
      releaseId: 'r',
      branch: 'main',
      commit: 'abc',
      idempotencyKey: 'k',
    };
    expect(SecurityScanInputSchema.parse(input)).toEqual(input);
    expect(SecurityScanInputSchema.parse(VALID)).toEqual(VALID);
  });

  it.each([
    ['no target', { targetUrl: undefined }],
    ['a file: target', { targetUrl: 'file:///etc/passwd' }],
    ['a target with credentials', { targetUrl: 'http://u:p@host.test/' }],
    ['a target that is not a URL', { targetUrl: 'host.test' }],
    ['spider minutes over the ceiling', { spiderMinutes: ZAP_MAX_SPIDER_MINUTES + 1 }],
    ['zero spider minutes', { spiderMinutes: 0 }],
    ['an arbitrary command', { command: ['zap.sh', '-cmd'] }],
    ['an active scan', { scan: 'full' }],
    ['a caller-chosen timeout', { timeoutMs: 1 }],
  ])('refuses %s', (_name, extra) => {
    expect(SecurityScanInputSchema.safeParse({ ...VALID, ...extra }).success).toBe(false);
  });

  it('exports a default inside the ceiling', () => {
    expect(ZAP_DEFAULT_SPIDER_MINUTES).toBeLessThanOrEqual(ZAP_MAX_SPIDER_MINUTES);
  });
});

describe('ZapJobConfigurationSchema', () => {
  it('is a baseline scan with explicit bounded minutes, and nothing else', () => {
    expect(ZapJobConfigurationSchema.parse({ scan: 'baseline', spiderMinutes: 2 })).toEqual({
      scan: 'baseline',
      spiderMinutes: 2,
    });
    expect(ZapJobConfigurationSchema.safeParse({ scan: 'full', spiderMinutes: 2 }).success).toBe(
      false,
    );
    expect(ZapJobConfigurationSchema.safeParse({ scan: 'baseline' }).success).toBe(false);
    expect(
      ZapJobConfigurationSchema.safeParse({ scan: 'baseline', spiderMinutes: 99 }).success,
    ).toBe(false);
  });
});
