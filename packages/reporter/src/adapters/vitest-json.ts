import type { ProducerAdapter } from '../adapter.js';
import { jestShapedAdapter } from './jest-json.js';

/**
 * Vitest's `--reporter=json` output. Vitest writes the Jest-compatible shape, so the reading is
 * `jest-json.ts`'s; what differs is the producer, its status words, and `retryCount`.
 */
export const vitestJsonAdapter: ProducerAdapter = jestShapedAdapter(
  'vitest',
  'Vitest JSON report',
  'application/vnd.vitest.results+json',
);
