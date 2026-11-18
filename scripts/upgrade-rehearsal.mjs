/**
 * `pnpm upgrade:rehearse` — install the last release the way a user did, put data in it, back it
 * up, update it to this tree's images, check nothing was lost, then roll back to the backup.
 *
 * 1. Downloads `lupin-<from>.zip` and `SHA256SUMS` from the GitHub release and checks the digest.
 * 2. `./start.sh` (no browser): the published images, a fresh `.env`.
 * 3. Seeds it with the installation key: a project, a SARIF report with a finding, a JUnit run.
 * 4. `./start.sh backup`.
 * 5. Builds this tree's images and tags them as the candidate, then `./start.sh update --version
 *    <candidate>`: the update path a user runs, against images that exist only on this host.
 * 6. Reads the install again (`lib/upgrade-rehearsal.mjs` decides what must have held).
 * 7. Rolls back: `./start.sh update --version <from>` and `./start.sh restore <backup>`.
 *
 * Needs Docker, a POSIX shell, `unzip` and the network. Tier `release`: run by
 * `release-gate.yml`, never in a pull request.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { upgradeProblems } from './lib/upgrade-rehearsal.mjs';
import { PUBLISHED_IMAGES, imageReference } from './lib/release-compose.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (/** @type {string} */ flag, /** @type {string} */ fallback) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};
const FROM = arg('--from', '4.1.0');
const CANDIDATE = arg('--candidate', '5.0.0-candidate');
const PORT = 18080;
const work = mkdtempSync(path.join(tmpdir(), 'lupin-upgrade-'));
const install = path.join(work, `lupin-${FROM}`);

/** @param {string} command @param {string[]} args @param {string} [cwd] */
function sh(command, args, cwd = install) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, LUPIN_NO_BROWSER: '1', LUPIN_PORT: String(PORT) },
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}`);
}

const env = () => readFileSync(path.join(install, '.env'), 'utf8');
const envValue = (/** @type {string} */ name) =>
  env()
    .split('\n')
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim() ?? '';

/** @param {string} pathname @param {RequestInit} [init] */
async function api(pathname, init = {}) {
  const response = await fetch(`http://127.0.0.1:${String(PORT)}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${envValue('LUPIN_INSTALLATION_KEY')}`, ...init.headers },
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

/** @returns {Promise<import('./lib/upgrade-rehearsal.mjs').InstallReading>} */
async function reading() {
  // The tag the api container actually runs: what an update changes, read from Docker itself.
  const image = spawnSync('docker', ['compose', 'ps', 'api', '--format', '{{.Image}}'], {
    cwd: install,
    encoding: 'utf8',
  }).stdout.trim();
  const version = image.split(':').at(-1) ?? 'unknown';
  /** @type {Array<{ id: string, slug: string }>} */
  const projects = (await api('/api/v1/projects')).body?.projects ?? [];
  const seeded = projects.find((entry) => entry.slug === 'upgrade-shop');
  const findings = seeded
    ? (
        (await api(`/api/v1/projects/${seeded.id}/health/findings?branch=main`)).body?.findings ??
        []
      ).length
    : 0;
  const runs = ((await api('/api/v1/runs')).body ?? []).length;
  return {
    version: String(version),
    // Every secret must survive; LUPIN_VERSION is the one line an update writes on purpose.
    envDigest: createHash('sha256')
      .update(
        env()
          .split('\n')
          .filter((line) => !line.startsWith('LUPIN_VERSION='))
          .join('\n'),
      )
      .digest('hex'),
    projects: projects.map((entry) => entry.slug),
    findings,
    runs,
  };
}

/** @type {boolean} */
let failed;
try {
  const base = `https://github.com/Sergey-Bar/Lupin/releases/download/v${FROM}`;
  const zip = Buffer.from(await (await fetch(`${base}/lupin-${FROM}.zip`)).arrayBuffer());
  const sums = await (await fetch(`${base}/SHA256SUMS`)).text();
  const digest = createHash('sha256').update(zip).digest('hex');
  if (!sums.includes(`${digest}  lupin-${FROM}.zip`))
    throw new Error(`lupin-${FROM}.zip does not match SHA256SUMS`);
  writeFileSync(path.join(work, 'release.zip'), zip);
  sh('unzip', ['-q', 'release.zip'], work);

  sh('sh', ['./start.sh']);
  const created = await api('/api/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'upgrade-shop',
      slug: 'upgrade-shop',
      gitUrl: 'https://github.com/acme/shop.git',
      defaultBranch: 'main',
    }),
  });
  if (created.status !== 201)
    throw new Error(`seeding a project answered ${String(created.status)}`);
  const projectId = created.body.project.id;
  // Uploads take an uploader token pinned to the project, as CI holds, not the installation key.
  const minted = await api('/api/v1/access-tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'upgrade rehearsal',
      role: 'uploader',
      projectId,
      expiresInDays: 1,
    }),
  });
  if (minted.status !== 201)
    throw new Error(`minting an uploader token answered ${String(minted.status)}`);
  const sarif = {
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'semgrep', rules: [] } },
        results: [
          {
            ruleId: 'js.eval',
            level: 'warning',
            message: { text: 'eval of input' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/a.ts' },
                  region: { startLine: 3 },
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const upload = await api(
    `/api/v1/projects/${projectId}/health/reports?format=sarif&branch=main`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.body.token}` },
      body: JSON.stringify(sarif),
    },
  );
  if (upload.status !== 201) throw new Error(`seeding a report answered ${String(upload.status)}`);
  const before = await reading();

  sh('sh', ['./start.sh', 'backup']);
  const backup = readdirSync(path.join(install, 'backups')).find((name) =>
    name.startsWith('lupin-'),
  );
  if (backup === undefined) throw new Error('./start.sh backup wrote no backup');

  // This tree's images, under the names the release compose file pulls.
  sh(
    'docker',
    ['compose', '-f', 'infra/compose/docker-compose.unified.yml', '-p', 'lupin-candidate', 'build'],
    ROOT,
  );
  for (const service of PUBLISHED_IMAGES) {
    sh('docker', ['tag', `lupin-candidate-${service}`, imageReference(service, CANDIDATE)], ROOT);
  }
  sh('sh', ['./start.sh', 'update', '--version', CANDIDATE]);
  const after = await reading();

  sh('sh', ['./start.sh', 'update', '--version', FROM]);
  sh('sh', ['./start.sh', 'restore', `backups/${backup}`]);
  const rolledBack = await reading();

  const problems = upgradeProblems({ before, after, rolledBack, candidate: CANDIDATE });
  const lines = [
    `### Upgrade ${FROM} → ${CANDIDATE}`,
    '',
    `Before: ${JSON.stringify({ ...before, envDigest: undefined })}`,
    `After: ${JSON.stringify({ ...after, envDigest: undefined })}`,
    `Rolled back: ${JSON.stringify({ ...rolledBack, envDigest: undefined })}`,
    ...problems.map((problem) => `- PROBLEM ${problem}`),
  ];
  console.log(lines.join('\n'));
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) writeFileSync(summary, `${lines.join('\n')}\n\n`, { flag: 'a' });
  failed = problems.length > 0;
} catch (error) {
  console.error(
    `upgrade rehearsal failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  failed = true;
} finally {
  spawnSync('sh', ['./start.sh', 'uninstall', '--purge'], {
    cwd: install,
    stdio: 'inherit',
    input: 'y\n',
  });
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
