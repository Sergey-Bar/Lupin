import { describe, expect, it } from 'vitest';
import { reporterHarness } from '../test-support/reporter-harness.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';

/**
 * A `jest --json` document through `POST /api/v1/reporter/upload` with `format=jest`. The
 * format is declared because JSON is JSON: nothing in the bytes says Jest.
 */
const RUN_ID = '3c1f6a5e-6f1a-4f3a-8c1e-2a7d1d1d1d1e';
const report = {
  numTotalTests: 3,
  success: false,
  testResults: [
    {
      name: 'src/cart.test.ts',
      status: 'failed',
      assertionResults: [
        {
          ancestorTitles: ['cart'],
          title: 'adds tax',
          status: 'passed',
          duration: 4,
          failureMessages: [],
        },
        {
          ancestorTitles: ['cart'],
          title: 'removes an item',
          status: 'failed',
          duration: 9,
          failureMessages: ['Error: expected 1 to be 0'],
        },
        { ancestorTitles: ['cart'], title: 'ships abroad', status: 'pending', failureMessages: [] },
      ],
    },
  ],
};

describe('POST /api/v1/reporter/upload with format=jest', () => {
  it("records the run and each of the report's tests", async () => {
    const repository = new InMemoryRunRepository();
    const { app } = reporterHarness(undefined, { repository });
    const form = new FormData();
    form.set('format', 'jest');
    form.set('runId', RUN_ID);
    form.set('file', new File([JSON.stringify(report)], 'jest.json', { type: 'application/json' }));

    const response = await app.request('/api/v1/reporter/upload', { method: 'POST', body: form });

    expect(response.status).toBe(202);
    expect(await repository.getRun(RUN_ID)).toMatchObject({
      status: 'failed',
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    });
    const stored = await repository.listTests(RUN_ID);
    expect(stored.map((test) => [test.title, test.status]).sort()).toEqual([
      ['adds tax', 'passed'],
      ['removes an item', 'failed'],
      ['ships abroad', 'skipped'],
    ]);
    expect(stored.find((test) => test.title === 'removes an item')?.errorMessage).toBe(
      'Error: expected 1 to be 0',
    );
  });
});
