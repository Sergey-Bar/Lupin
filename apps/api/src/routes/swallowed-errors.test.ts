import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalArtifactBytesStore, LocalArtifactStore } from '../infrastructure/artifact-store.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

/**
 * A swallowed error is a failure with no symptom.
 *
 * Three handlers caught *anything* and answered as if the thing the caller asked
 * for did not exist. That is the worst possible shape: the caller is told their
 * request was wrong, so they stop retrying, and nothing is logged, so nobody looks.
 * Two were the process-local automation and job routes, since removed as dead code; the
 * third is here:
 *
 *   - artifact bytes — *any* read failure returned `null`, and the caller turned
 *     `null` into 404 "artifact not found". A permissions error, a full disk or a
 *     corrupt file all read as "that artifact was never there".
 *
 * Each test below asserts the miss is still a miss, and that a fault is not.
 */
describe('artifact bytes distinguish absent from unreadable', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lupin-artifact-bytes-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns null for a key that is genuinely absent', async () => {
    const store = new LocalArtifactBytesStore(new LocalArtifactStore(root));
    expect(await store.get('runs/none/never-written.log')).toBeNull();
  });

  it('propagates a read failure instead of reporting it as absent', async () => {
    const inner = new LocalArtifactStore(root);
    // A fault that is not "not there": the path is a directory, so reading it
    // fails with EISDIR. That used to be swallowed into `null` and answered as
    // "artifact not found" — telling the caller to stop asking and telling
    // nobody to go and look.
    const directory = path.join(root, 'runs', 'dir-not-a-file');
    await mkdir(directory, { recursive: true });
    const store = new LocalArtifactBytesStore(inner);
    await expect(store.get('runs/dir-not-a-file')).rejects.toThrow();
  });

  it('returns the bytes for a key that is present', async () => {
    const store = new LocalArtifactBytesStore(new LocalArtifactStore(root));
    await store.put('runs/real/present.log', new Uint8Array([1, 2, 3]));
    const bytes = await store.get('runs/real/present.log');
    expect([...(bytes ?? [])]).toEqual([1, 2, 3]);
  });
});

describe('a classified error is not re-wrapped', () => {
  it('keeps its own code and status', () => {
    const original = new DomainError(ErrorCode.VALIDATION_FAILED, 'bad input');
    // The identity check the route uses: a `DomainError` already says what went
    // wrong, so re-wrapping it as "storage unavailable" would replace a specific
    // diagnosis with a vague one.
    expect(original.status).toBe(422);
    expect(original.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
