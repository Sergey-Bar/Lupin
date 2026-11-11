import { usage } from './errors.js';

/**
 * `lupin gate --post`: the job posts the gate's status, check run and comment with its own
 * GitHub token, for an install that holds none — a LAN install GitHub cannot reach, or one
 * nobody gave a token. The server renders every byte (`githubPayload` in the gate's answer),
 * so what the job posts is what the server would have posted.
 *
 * **The two tokens never meet.** `LUPIN_TOKEN` goes only to `LUPIN_URL` (`http.ts`), and
 * `GITHUB_TOKEN` only to `GITHUB_API_URL` — `https://`, never redirected. Neither appears in
 * the other's request, and `github-post.test.ts` asserts both directions.
 *
 * **Posting never changes the verdict.** A refusal from GitHub is printed and the job exits
 * with the gate's own code: a pull request that cannot be commented on is not a failed gate,
 * and a failed gate is not excused by a comment that could not be written.
 */

export interface GitHubTarget {
  api: URL;
  owner: string;
  repo: string;
  token: string;
}

interface Payload {
  sha: string;
  status: Record<string, unknown>;
  checkRun: (Record<string, unknown> & { name: string }) | null;
  comment: { marker: string; body: string } | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The gate's `githubPayload`, or `null` when the answer carries none. Read defensively. */
export function payloadOf(answer: unknown): Payload | null {
  if (!isRecord(answer) || !isRecord(answer['githubPayload'])) return null;
  const raw = answer['githubPayload'];
  const sha = raw['sha'];
  const status = raw['status'];
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/iu.test(sha) || !isRecord(status)) return null;
  const check = raw['checkRun'];
  const comment = raw['comment'];
  return {
    sha,
    status,
    checkRun:
      isRecord(check) && typeof check['name'] === 'string'
        ? { ...check, name: check['name'] }
        : null,
    comment:
      isRecord(comment) &&
      typeof comment['marker'] === 'string' &&
      typeof comment['body'] === 'string'
        ? { marker: comment['marker'], body: comment['body'] }
        : null,
  };
}

const REPOSITORY = /^([\w.-]{1,100})\/([\w.-]{1,100})$/u;

/** Where to post, from Actions' own variables. Refused before the gate is even asked. */
export function githubTarget(env: Readonly<Record<string, string | undefined>>): GitHubTarget {
  const token = env['GITHUB_TOKEN']?.trim() ?? '';
  if (token === '') {
    throw usage(
      '--post needs GITHUB_TOKEN: pass `env: GITHUB_TOKEN: ${{ github.token }}` to the step.',
    );
  }
  const repository = REPOSITORY.exec(env['GITHUB_REPOSITORY']?.trim() ?? '');
  if (repository === null) throw usage('--post needs GITHUB_REPOSITORY as owner/repo.');
  let api: URL;
  try {
    api = new URL(env['GITHUB_API_URL']?.trim() || 'https://api.github.com');
  } catch {
    throw usage('GITHUB_API_URL is not a URL.');
  }
  if (api.protocol !== 'https:' || api.username !== '' || api.password !== '') {
    throw usage('GITHUB_API_URL must be https:// with no credentials in it.');
  }
  return { api, owner: repository[1] as string, repo: repository[2] as string, token };
}

type Fetch = typeof fetch;

async function call(
  fetchImpl: Fetch,
  target: GitHubTarget,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = target.api.href.endsWith('/') ? target.api.href : `${target.api.href}/`;
  const url = new URL(
    `repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${path}`,
    base,
  );
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${target.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      data = text;
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const idOf = (value: unknown): number | null =>
  isRecord(value) && typeof value['id'] === 'number' ? value['id'] : null;

async function postCheckRun(
  fetchImpl: Fetch,
  target: GitHubTarget,
  payload: Payload,
  check: Payload['checkRun'] & object,
) {
  const listed = await call(
    fetchImpl,
    target,
    'GET',
    `commits/${encodeURIComponent(payload.sha)}/check-runs?check_name=${encodeURIComponent(check.name)}&per_page=100`,
  );
  if (!listed.ok) return listed.status;
  const runs =
    isRecord(listed.data) && Array.isArray(listed.data['check_runs'])
      ? listed.data['check_runs']
      : [];
  const existing = runs.map(idOf).find((id) => id !== null);
  const written =
    existing === undefined
      ? await call(fetchImpl, target, 'POST', 'check-runs', { ...check, head_sha: payload.sha })
      : await call(fetchImpl, target, 'PATCH', `check-runs/${String(existing)}`, check);
  return written.ok ? (existing === undefined ? 'created' : 'updated') : written.status;
}

async function postComment(
  fetchImpl: Fetch,
  target: GitHubTarget,
  pullRequest: number,
  comment: NonNullable<Payload['comment']>,
) {
  const listed = await call(
    fetchImpl,
    target,
    'GET',
    `issues/${String(pullRequest)}/comments?per_page=100`,
  );
  if (!listed.ok) return listed.status;
  const comments = Array.isArray(listed.data) ? listed.data : [];
  const existing = comments.find(
    (entry) =>
      isRecord(entry) &&
      typeof entry['body'] === 'string' &&
      entry['body'].startsWith(comment.marker),
  );
  const id = idOf(existing);
  const written =
    id === null
      ? await call(fetchImpl, target, 'POST', `issues/${String(pullRequest)}/comments`, {
          body: comment.body,
        })
      : await call(fetchImpl, target, 'PATCH', `issues/comments/${String(id)}`, {
          body: comment.body,
        });
  return written.ok ? (id === null ? 'created' : 'updated') : written.status;
}

/** One line per thing posted or refused. A number is the HTTP status GitHub refused with. */
export async function postToGitHub(
  fetchImpl: Fetch,
  target: GitHubTarget,
  payload: Payload,
  pullRequest: number | undefined,
): Promise<string[]> {
  const lines: string[] = [];
  const say = (what: string, outcome: string | number) =>
    lines.push(
      typeof outcome === 'number'
        ? `GitHub refused the ${what} (${outcome === 0 ? 'unreachable' : `HTTP ${String(outcome)}`}); the gate's verdict stands.`
        : `Posted the ${what} (${outcome}).`,
    );
  const status = await call(
    fetchImpl,
    target,
    'POST',
    `statuses/${encodeURIComponent(payload.sha)}`,
    payload.status,
  );
  say('commit status', status.ok ? 'created' : status.status);
  if (payload.checkRun !== null)
    say('check run', await postCheckRun(fetchImpl, target, payload, payload.checkRun));
  if (payload.comment !== null && pullRequest !== undefined) {
    say('pull request comment', await postComment(fetchImpl, target, pullRequest, payload.comment));
  }
  return lines;
}
