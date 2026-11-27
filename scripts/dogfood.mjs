/**
 * `pnpm dogfood` — Lupin grades Lupin, with the packages a user installs.
 *
 * Two layers, chosen by the environment:
 *
 * - **In-job (always).** With no `LUPIN_DOGFOOD_URL`, the production compose stack is booted on
 *   this runner (`compose-boot.mjs --keep --env-out`), signed in to with the key it generated,
 *   and torn down at the end.
 * - **Reference install (when configured).** With `LUPIN_DOGFOOD_URL` and `LUPIN_DOGFOOD_KEY`, the
 *   same uploads go to that long-running install, which keeps the history. Never a
 *   non-loopback `http:` address: the CLI refuses one, and an https install off this host is a
 *   LAN- or remote-mode install that already enforces access.
 *
 * Either way the packed `lupin` CLI runs this repository's own tests (`lupin test`), sends its
 * agent configuration (`lupin agent-config`), and asks the gate (`lupin gate`); then the
 * project's grade and release verdict are read back and must exist. Nothing leaves either
 * install: this is the operator's own data, read by the operator.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT, installPackedTools } from './lib/pack-tools.mjs';
import { dogfoodProblems } from './lib/dogfood.mjs';

const PROJECT_SLUG = 'lupin-dogfood';
const COMPOSE_PROJECT = 'lupin-compose-boot';
const COMPOSE_FILE = 'infra/compose/docker-compose.unified.yml';
/** The packages whose suites the job runs: fast, and they cover the scoring and the reporters. */
const SUITES = ['@lupin/reporting', '@lupin/projects', '@lupin/reporter'];

const reference = process.env['LUPIN_DOGFOOD_URL']?.trim();
const scratch = mkdtempSync(path.join(tmpdir(), 'lupin-dogfood-'));
const base = reference ?? 'http://127.0.0.1:8080';
let key = process.env['LUPIN_DOGFOOD_KEY']?.trim() ?? '';
let booted = false;

/** @param {string} pathname @param {RequestInit} [init] */
async function api(pathname, init = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

/** @param {string} cli @param {string[]} args @param {Record<string, string>} env */
function lupin(cli, args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.status ?? -1;
}

const tools = installPackedTools();
try {
  if (reference === undefined) {
    const envOut = path.join(scratch, 'boot.env');
    const boot = spawnSync(
      process.execPath,
      ['scripts/compose-boot.mjs', '--keep', '--env-out', envOut],
      {
        cwd: REPO_ROOT,
        stdio: 'inherit',
      },
    );
    booted = true;
    if (boot.status !== 0) throw new Error('the compose stack did not boot');
    const line = readFileSync(envOut, 'utf8')
      .split('\n')
      .find((entry) => entry.startsWith('LUPIN_INSTALLATION_KEY='));
    key = line?.slice('LUPIN_INSTALLATION_KEY='.length).trim() ?? '';
  } else if (key === '') {
    throw new Error('LUPIN_DOGFOOD_URL is set without LUPIN_DOGFOOD_KEY');
  }

  const listed = await api('/api/v1/projects');
  /** @type {Array<{ id: string, slug: string }>} */
  const projects = listed.body?.projects ?? [];
  let projectId = projects.find((entry) => entry.slug === PROJECT_SLUG)?.id;
  if (projectId === undefined) {
    const created = await api('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Lupin',
        slug: PROJECT_SLUG,
        gitUrl: 'https://github.com/Sergey-Bar/Lupin.git',
        defaultBranch: 'main',
      }),
    });
    if (created.status !== 201)
      throw new Error(`registering the project answered ${String(created.status)}`);
    projectId = created.body.project.id;
  }
  const minted = await api('/api/v1/access-tokens', {
    method: 'POST',
    body: JSON.stringify({ name: 'dogfood', role: 'uploader', projectId, expiresInDays: 1 }),
  });
  if (minted.status !== 201)
    throw new Error(`minting an uploader token answered ${String(minted.status)}`);
  const branch = process.env['GITHUB_REF_NAME']?.trim() || 'main';
  const commit =
    process.env['GITHUB_SHA']?.trim() ||
    spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const env = { LUPIN_URL: base, LUPIN_TOKEN: minted.body.token, LUPIN_PROJECT: String(projectId) };

  /** @type {Record<string, number>} */
  const exits = {};
  for (const suite of SUITES) {
    const report = path.join(scratch, `${suite.replace(/\W+/gu, '-')}.xml`);
    exits[suite] = lupin(
      tools.cliEntry,
      [
        'test',
        '--format',
        'junit',
        '--report',
        report,
        '--branch',
        branch,
        '--commit',
        commit,
        '--',
        process.execPath,
        process.env['npm_execpath'] ?? 'pnpm',
        '--filter',
        suite,
        'exec',
        'vitest',
        'run',
        '--reporter=junit',
        `--outputFile=${report}`,
      ],
      env,
    );
  }
  exits['agent-config'] = lupin(
    tools.cliEntry,
    ['agent-config', '--branch', branch, '--commit', commit],
    env,
  );
  exits['gate'] = lupin(tools.cliEntry, ['gate', '--branch', branch, '--commit', commit], env);

  const health = await api(
    `/api/v1/projects/${String(projectId)}/health?branch=${encodeURIComponent(branch)}`,
  );
  const readiness = await api(`/api/v1/projects/${String(projectId)}/readiness?days=7`);
  const problems = dogfoodProblems({ exits, health: health.body, readiness: readiness.body });
  const grade = health.body?.grade;
  const lines = [
    '### Lupin grades Lupin',
    '',
    `Install: ${reference === undefined ? 'booted in this job' : 'the reference install'}`,
    `Grade on ${branch}: ${grade?.letter ?? 'incomplete'} (${grade?.score ?? '—'}) — ${grade?.incomplete ? grade.incompleteReason : (grade?.limiter ?? '')}`,
    `Release verdict: ${readiness.body?.verdict ?? 'unread'}`,
    '',
    ...Object.entries(exits).map(([step, code]) => `- ${step}: exit ${String(code)}`),
    ...problems.map((problem) => `- PROBLEM ${problem}`),
  ];
  console.log(lines.join('\n'));
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) writeFileSync(summary, `${lines.join('\n')}\n\n`, { flag: 'a' });
  if (problems.length > 0) process.exitCode = 1;
} finally {
  tools.cleanup();
  if (booted) {
    const envOut = path.join(scratch, 'boot.env');
    spawnSync(
      'docker',
      [
        'compose',
        '-p',
        COMPOSE_PROJECT,
        '--env-file',
        envOut,
        '-f',
        COMPOSE_FILE,
        'down',
        '-v',
        '--remove-orphans',
      ],
      {
        cwd: REPO_ROOT,
        stdio: 'inherit',
      },
    );
  }
  rmSync(scratch, { recursive: true, force: true });
}
