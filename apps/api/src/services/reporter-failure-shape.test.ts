/**
 * Why a test failed, in both shapes a producer can send it.
 *
 * The shipped Playwright reporter sends `error: { code, message }`; the published contract
 * (`TestCompletedSchema` in shared-contracts) declares a flat `errorMessage`. A producer
 * written against the contract had its reason dropped, so the dashboard and the copilot
 * read "Failed with no message" for a failure that came with one.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import type { NormalizedReporterEvent } from '../routes/reporter.js';
import { persistReporterEvent } from './reporter-persistence.js';

const RUN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3399';
const AT = '2026-11-10T10:00:00.000Z';

function event(type: string, payload: unknown): NormalizedReporterEvent {
  return { version: '1', type, runId: RUN_ID, timestamp: AT, payload };
}

async function failWith(payload: Record<string, unknown>) {
  const repository = new InMemoryRunRepository();
  await persistReporterEvent(event('run:start', { total: 1 }), repository);
  await persistReporterEvent(event('test:begin', { testId: 't1', title: 'pays' }), repository);
  await persistReporterEvent(
    event('test:end', { testId: 't1', status: 'failed', ...payload }),
    repository,
  );
  return repository.getTest('t1', RUN_ID);
}

describe('a failed test keeps its reason', () => {
  it('from the nested error the Playwright reporter sends', async () => {
    const test = await failWith({ error: { code: 'ASSERTION_FAILED', message: 'boom' } });
    expect(test).toMatchObject({ errorCode: 'ASSERTION_FAILED', errorMessage: 'boom' });
  });

  it('from the flat errorMessage the published contract declares', async () => {
    const test = await failWith({ errorCode: 'ASSERTION_FAILED', errorMessage: 'boom' });
    expect(test).toMatchObject({ errorCode: 'ASSERTION_FAILED', errorMessage: 'boom' });
  });

  it('prefers the nested error when a producer sends both', async () => {
    const test = await failWith({ error: { message: 'nested' }, errorMessage: 'flat' });
    expect(test).toMatchObject({ errorMessage: 'nested' });
  });
});
