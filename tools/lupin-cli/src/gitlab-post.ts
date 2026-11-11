import { usage } from './errors.js';
import type { payloadOf } from './github-post.js';

/**
 * `lupin gate --post` in a GitLab CI job: the gate's verdict as a commit status, and its one
 * comment as a merge-request note, created once and updated on every push.
 *
 * The server renders every byte (`githubPayload`), so a GitLab merge request reads what a GitHub
 * pull request would. GitLab has no check runs: the risk factors are in the note. The token is
 * `LUPIN_GITLAB_TOKEN` (a project access token with the `api` scope; `CI_JOB_TOKEN` cannot write
 * statuses or notes), and it goes only to `CI_API_V4_URL`, never to Lupin.
 *
 * **Posting never changes the verdict.** A refusal from GitLab is printed and the job exits with
 * the gate's own code.
 */

export interface GitLabTarget {
  api: URL;
  /** The numeric project id, `CI_PROJECT_ID`. */
  project: string;
  token: string;
}

type Payload = NonNullable<ReturnType<typeof payloadOf>>;
type Fetch = typeof fetch;

export function isGitLabCi(env: Readonly<Record<string, string | undefined>>): boolean {
  return env['GITLAB_CI'] === 'true';
}

/** Where to post, from GitLab CI's own variables. Refused before the gate is even asked. */
export function gitlabTarget(env: Readonly<Record<string, string | undefined>>): GitLabTarget {
  const token = env['LUPIN_GITLAB_TOKEN']?.trim() ?? '';
  if (token === '') {
    throw usage(
      '--post on GitLab needs LUPIN_GITLAB_TOKEN: a project access token with the api scope, as a masked CI/CD variable.',
    );
  }
  const project = env['CI_PROJECT_ID']?.trim() ?? '';
  if (!/^\d{1,20}$/u.test(project)) throw usage('--post on GitLab needs CI_PROJECT_ID.');
  let api: URL;
  try {
    api = new URL(env['CI_API_V4_URL']?.trim() || 'https://gitlab.com/api/v4');
  } catch {
    throw usage('CI_API_V4_URL is not a URL.');
  }
  if (api.protocol !== 'https:' || api.username !== '' || api.password !== '') {
    throw usage('CI_API_V4_URL must be https:// with no credentials in it.');
  }
  return { api, project, token };
}

/** `--pr` on GitHub; on GitLab the merge request the pipeline runs for, when none is given. */
export function mergeRequestOf(
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const iid = Number(env['CI_MERGE_REQUEST_IID']);
  return Number.isInteger(iid) && iid > 0 ? iid : undefined;
}

async function call(
  fetchImpl: Fetch,
  target: GitLabTarget,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = target.api.href.endsWith('/') ? target.api.href : `${target.api.href}/`;
  const url = new URL(`projects/${encodeURIComponent(target.project)}/${path}`, base);
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: {
        'private-token': target.token,
        accept: 'application/json',
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** GitLab's commit status from the server's GitHub-shaped one. */
function statusBody(payload: Payload): Record<string, unknown> {
  const status = payload.status;
  return {
    state: status['state'] === 'success' ? 'success' : 'failed',
    name: typeof status['context'] === 'string' ? status['context'] : 'lupin/health',
    ...(typeof status['description'] === 'string'
      ? { description: status['description'].slice(0, 255) }
      : {}),
    ...(typeof status['target_url'] === 'string' ? { target_url: status['target_url'] } : {}),
  };
}

async function postNote(
  fetchImpl: Fetch,
  target: GitLabTarget,
  mergeRequest: number,
  comment: NonNullable<Payload['comment']>,
): Promise<string | number> {
  const notes = `merge_requests/${String(mergeRequest)}/notes`;
  const listed = await call(fetchImpl, target, 'GET', `${notes}?per_page=100&sort=asc`);
  if (!listed.ok) return listed.status;
  const existing = (Array.isArray(listed.data) ? listed.data : []).find(
    (note) =>
      isRecord(note) && typeof note['body'] === 'string' && note['body'].startsWith(comment.marker),
  );
  const id = isRecord(existing) && typeof existing['id'] === 'number' ? existing['id'] : null;
  const written =
    id === null
      ? await call(fetchImpl, target, 'POST', notes, { body: comment.body })
      : await call(fetchImpl, target, 'PUT', `${notes}/${String(id)}`, { body: comment.body });
  return written.ok ? (id === null ? 'created' : 'updated') : written.status;
}

/** One line per thing posted or refused. A number is the HTTP status GitLab refused with. */
export async function postToGitLab(
  fetchImpl: Fetch,
  target: GitLabTarget,
  payload: Payload,
  mergeRequest: number | undefined,
): Promise<string[]> {
  const lines: string[] = [];
  const say = (what: string, outcome: string | number) =>
    lines.push(
      typeof outcome === 'number'
        ? `GitLab refused the ${what} (${outcome === 0 ? 'unreachable' : `HTTP ${String(outcome)}`}); the gate's verdict stands.`
        : `Posted the ${what} (${outcome}).`,
    );
  const status = await call(
    fetchImpl,
    target,
    'POST',
    `statuses/${encodeURIComponent(payload.sha)}`,
    statusBody(payload),
  );
  say('commit status', status.ok ? 'created' : status.status);
  if (payload.comment !== null && mergeRequest !== undefined) {
    say('merge request note', await postNote(fetchImpl, target, mergeRequest, payload.comment));
  }
  return lines;
}
