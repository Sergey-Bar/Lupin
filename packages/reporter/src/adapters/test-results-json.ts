import { createHash } from 'node:crypto';
import { testIdentity, type CanonicalRunResult } from '@lupin/shared-contracts';
import type { ProducerContext } from '../adapter.js';
import { canonicalRunResult, type CanonicalAttemptInput } from '../canonical-run-result.js';
import {
  canonicalTestStatusFrom,
  outcomesWithDeclaredRunStatus,
  type CanonicalStatus,
  type IngestedProducer,
} from '../producer-status.js';

/**
 * What the five JSON test-result adapters (CTRF, Jest, Vitest, pytest-json-report and
 * Mochawesome) share once each has read its own document: a list of tests, each with its
 * attempts in order, turned into one canonical result.
 *
 * The rules are the Allure adapter's, so a retried test reads the same from every producer:
 * one identity per test (`testIdentity`), attempts numbered from 1 in the order the producer
 * wrote them, the outcome is the last attempt's, and a test whose attempts disagree is flaky.
 */

const MAX_MESSAGE = 8_192;
const UNKNOWN_FILE = 'unknown.spec.ts';

type Evidence = CanonicalRunResult['evidence'][number];
type Step = CanonicalRunResult['steps'][number];

/** One attachment the producer names by path. The bytes were not sent. */
export interface AttachmentReference {
  name: string;
  path: string;
  contentType?: string;
}

/** One step the producer reported inside an attempt. */
export interface StepInput {
  name: string;
  rawStatus: string;
  message?: string;
}

export interface AttemptInput {
  rawStatus: string;
  status: CanonicalStatus;
  durationMs?: number;
  startedAt?: string;
  message?: string;
  attachments?: AttachmentReference[];
  steps?: StepInput[];
}

export interface TestInput {
  file: string;
  describePath: string[];
  title: string;
  project?: string;
  attempts: AttemptInput[];
  /** The producer said the test is flaky even when its attempts do not show it. */
  flaky?: boolean;
}

/** The document as JSON, or an Error that names the format the caller declared. */
export function parseJsonDocument(input: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(input)) as unknown;
  } catch (cause) {
    throw new Error(`${label} is not valid JSON`, { cause });
  }
}

/** A trimmed string, or `''`. */
export const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A non-negative finite number, or `undefined`. */
export function durationOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A producer status, through its table; an absent status is `unknown`, never a pass. */
export function statusOf(producer: IngestedProducer, rawStatus: string): CanonicalStatus {
  return canonicalTestStatusFrom(producer, rawStatus === '' ? 'unknown' : rawStatus);
}

/**
 * A relative path made of the producer's own segments: never absolute, never `..`. Jest and
 * Vitest write absolute file names, which the contract refuses; the root is dropped.
 */
export function relativePath(value: string): string {
  const segments = value
    .replaceAll('\\', '/')
    .replace(/^[a-zA-Z]:/u, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  return segments.length === 0 ? UNKNOWN_FILE : segments.join('/');
}

/**
 * An attachment the producer names by path, as an evidence reference.
 *
 * The bytes are not in the document, so `byteSize` is 0 and the digest is of the declared
 * path, which `metadata.digestOf` says. A digest of bytes nobody sent would be invented.
 */
function referenceOf(
  attachment: AttachmentReference,
  runId: string,
  testOrdinal: number,
  attemptIndex: number,
  attachmentIndex: number,
): Evidence {
  return {
    uri: `artifact://${runId}/${String(testOrdinal)}/${String(attemptIndex)}/${String(attachmentIndex)}/${encodeURIComponent(attachment.name)}`,
    mediaType: attachment.contentType ?? 'application/octet-stream',
    byteSize: 0,
    digest: createHash('sha256').update(attachment.path).digest('hex'),
    metadata: { path: attachment.path, digestOf: 'declared-path', uploaded: false },
  };
}

const messageOf = (message: string | undefined): { message: string } | undefined => {
  const trimmed = (message ?? '').trim().slice(0, MAX_MESSAGE);
  return trimmed === '' ? undefined : { message: trimmed };
};

/** Tests sharing one identity are one test's attempts, in the order they were written. */
function merged(tests: readonly TestInput[]): Map<string, TestInput> {
  const byIdentity = new Map<string, TestInput>();
  for (const test of tests) {
    const identity = testIdentity({
      file: test.file,
      describePath: test.describePath,
      title: test.title,
      project: test.project ?? '',
    });
    const entry = byIdentity.get(identity);
    if (entry === undefined) byIdentity.set(identity, { ...test, attempts: [...test.attempts] });
    else {
      entry.attempts.push(...test.attempts);
      entry.flaky = entry.flaky === true || test.flaky === true;
    }
  }
  return byIdentity;
}

export function testResultsRun(
  tests: readonly TestInput[],
  producer: IngestedProducer,
  verifier: string,
  context: ProducerContext,
  reportErrors: readonly { message: string }[] = [],
): CanonicalRunResult {
  const byIdentity = merged(tests.filter((test) => test.attempts.length > 0));
  if (byIdentity.size === 0) throw new Error(`${verifier}: the report contains no tests`);
  const outcomes: CanonicalStatus[] = [];
  const steps: Step[] = [];
  const attempts: CanonicalAttemptInput[] = [...byIdentity.entries()].flatMap(
    ([identity, test], testOrdinal) => {
      const statuses = test.attempts.map((attempt) => attempt.status);
      const disagree = statuses.some((status) => status !== statuses[0]);
      const last = statuses.at(-1) ?? 'unknown';
      const flaky = disagree || (test.flaky === true && last === 'passed');
      outcomes.push(flaky ? 'flaky' : last);
      return test.attempts.map((attempt, position) => {
        const index = position + 1;
        (attempt.steps ?? []).forEach((step, ordinal) => {
          steps.push({
            id: `${identity} #${String(index)} ${String(ordinal + 1)}. ${step.name}`,
            ordinal,
            status: statusOf(producer, step.rawStatus),
            error: messageOf(step.message),
            evidence: [],
            children: [],
          });
        });
        return {
          index,
          testId: identity,
          specPath: test.file,
          title: test.title,
          describePath: test.describePath,
          ...(test.project === undefined || test.project === '' ? {} : { project: test.project }),
          status: attempt.status,
          rawStatus: attempt.rawStatus === '' ? 'unknown' : attempt.rawStatus,
          startedAt: attempt.startedAt ?? context.startedAt,
          finishedAt: context.finishedAt,
          durationMs: attempt.durationMs,
          error: messageOf(attempt.message),
          evidence: (attempt.attachments ?? []).map((attachment, attachmentIndex) =>
            referenceOf(attachment, context.runId, testOrdinal, index, attachmentIndex),
          ),
          flakiness: flaky ? ('observed' as const) : ('unknown' as const),
        };
      });
    },
  );
  return canonicalRunResult(
    {
      outcomes: outcomesWithDeclaredRunStatus(outcomes, context.declaredRunStatus),
      attempts,
      steps,
      reportErrors: reportErrors.flatMap((error) => messageOf(error.message) ?? []),
      producer,
      verifier,
    },
    context,
  );
}
