// A runner image whose base image *is* the tool records the tool's version twice: in the
// Dockerfile's FROM tag and in `manifest.json`'s `toolVersion`. Dependabot bumps the first
// and knows nothing of the second, so without this test the manifest goes on describing
// the version the image no longer contains.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RUNNERS = path.join(ROOT, 'infra', 'runners');

/**
 * Every runner, and the image its tool ships in. `null` is a runner whose base is not the
 * tool (Playwright's image is plain Node), so its FROM tag says nothing about `toolVersion`.
 *
 * @type {Record<string, string | null>}
 */
const TOOL_IMAGE = {
  k6: 'grafana/k6',
  playwright: null,
  zap: 'ghcr.io/zaproxy/zaproxy',
};

/** @param {string} dockerfile @returns {{ image: string, tag: string }} */
function baseImage(dockerfile) {
  const from = dockerfile.split('\n').find((line) => /^FROM\s/u.test(line));
  assert.ok(from !== undefined, 'the Dockerfile has a FROM line');
  const reference = from.split(/\s+/u)[1] ?? '';
  const withoutDigest = reference.split('@')[0] ?? '';
  const colon = withoutDigest.lastIndexOf(':');
  return { image: withoutDigest.slice(0, colon), tag: withoutDigest.slice(colon + 1) };
}

test('every runner directory is classified, so a new one cannot skip the check', () => {
  const runners = readdirSync(RUNNERS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(runners, Object.keys(TOOL_IMAGE).sort());
});

for (const [runner, image] of Object.entries(TOOL_IMAGE)) {
  if (image === null) continue;
  test(`${runner}: manifest.json toolVersion is the version its Dockerfile pulls`, () => {
    const dockerfile = readFileSync(path.join(RUNNERS, runner, 'Dockerfile'), 'utf8');
    const manifest = JSON.parse(readFileSync(path.join(RUNNERS, runner, 'manifest.json'), 'utf8'));
    const base = baseImage(dockerfile);
    assert.equal(base.image, image);
    assert.equal(manifest.toolVersion, base.tag);
  });
}

test('the FROM reader takes the tag, not the digest or the stage name', () => {
  assert.deepEqual(baseImage('FROM grafana/k6:2.3.0@sha256:abc AS run\nUSER root\n'), {
    image: 'grafana/k6',
    tag: '2.3.0',
  });
  assert.deepEqual(baseImage('# comment\nFROM ghcr.io/zaproxy/zaproxy:2.17.0\n'), {
    image: 'ghcr.io/zaproxy/zaproxy',
    tag: '2.17.0',
  });
});

// ZAP runs as uid 65532, which the upstream image does not know: with no passwd entry Java's
// `user.home` is `?`, and `zap.sh -version` exits 1 with "Unable to create home directory:
// /zap/?/.ZAP/". With a home but no Firefox profile, the client add-on waits for ever on
// `firefox -CreateProfile`. Both were observed on 2.16.1 and 2.17.0 (ledger MNT-157); the
// stock `zap` user avoids them only because the image ships its profile in /home/zap.
test('zap: the runner user has a passwd entry, a writable home and the bundled Firefox profile', () => {
  const dockerfile = readFileSync(path.join(RUNNERS, 'zap', 'Dockerfile'), 'utf8');
  const manifest = JSON.parse(readFileSync(path.join(RUNNERS, 'zap', 'manifest.json'), 'utf8'));
  const user = String(manifest.user);
  const entry = new RegExp(
    `'[a-z][a-z0-9-]*:x:${user}:${user}::(/[^:]+):[^']*' >> /etc/passwd`,
    'u',
  );
  const home = dockerfile.match(entry)?.[1];
  assert.ok(home !== undefined, `the Dockerfile adds a passwd entry for uid ${user}`);
  assert.match(dockerfile, new RegExp(`mkdir -p [^\\n]*${home}(\\s|$)`, 'u'));
  assert.match(dockerfile, new RegExp(`cp -a /home/zap/\\.mozilla ${home}/\\.mozilla`, 'u'));
  assert.match(dockerfile, new RegExp(`chown -R ${user}:${user} /automation`, 'u'));
  assert.ok(home.startsWith('/automation/'), 'the home is inside the chowned tree');
  assert.match(dockerfile, new RegExp(`^USER ${user}:${user}$`, 'mu'));
  // The manifest declares a read-only root, so ZAP's state must live on the /tmp tmpfs.
  assert.equal(manifest.readOnly, true);
  assert.match(
    dockerfile,
    /^ENTRYPOINT \["\/automation\/bin\/zap-entrypoint\.sh"\]$/mu,
    'the entrypoint is the baseline wrapper',
  );
  const wrapper = readFileSync(path.join(RUNNERS, 'zap', 'zap-entrypoint.sh'), 'utf8');
  assert.match(wrapper, /exec zap\.sh -dir \/tmp\/[^ ]+ -version/u);
  assert.match(wrapper, /exec zap-baseline\.py -z "-dir \/tmp\/[^"]+" "\$@"/u);
});

// Plan task 19: the images stop being stubs. Each one's entrypoint is its tool (or, for ZAP,
// a wrapper that can run only the baseline scan), with no arguments printing the version that
// `oci:smoke` checks; each switches to the manifest's numeric user, and none carries a secret.
for (const runner of Object.keys(TOOL_IMAGE)) {
  test(`${runner}: runs its tool as the manifest's numeric user, with nothing secret baked in`, () => {
    const dockerfile = readFileSync(path.join(RUNNERS, runner, 'Dockerfile'), 'utf8');
    const manifest = JSON.parse(readFileSync(path.join(RUNNERS, runner, 'manifest.json'), 'utf8'));
    const users = [...dockerfile.matchAll(/^USER (.+)$/gmu)].map((match) => match[1]);
    assert.equal(users.at(-1), `${String(manifest.user)}:${String(manifest.user)}`);
    assert.notEqual(manifest.user, 0);
    assert.doesNotMatch(
      dockerfile,
      /^ENTRYPOINT \[(?:"node", "-e"|.*"-?-?version"\])/mu,
      'no stub entrypoint that only prints a version',
    );
    assert.doesNotMatch(dockerfile, /^(ENV|ARG) [A-Z_]*(TOKEN|SECRET|PASSWORD|KEY)\b/mu);
    assert.equal(manifest.network, 'none');
    assert.equal(typeof manifest.jobNetwork, 'string');
  });
}

test('playwright: the image installs the release the workspace locks, and the manifest says so', () => {
  const dockerfile = readFileSync(path.join(RUNNERS, 'playwright', 'Dockerfile'), 'utf8');
  const manifest = JSON.parse(
    readFileSync(path.join(RUNNERS, 'playwright', 'manifest.json'), 'utf8'),
  );
  const version = dockerfile.match(/^ARG PLAYWRIGHT_VERSION=(\S+)$/mu)?.[1];
  assert.equal(version, manifest.toolVersion);
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(lock.includes(`'@playwright/test@${String(version)}':`), 'the lockfile has it');
  assert.match(dockerfile, /playwright install --with-deps chromium/u);
  assert.match(dockerfile, /^ENTRYPOINT \["playwright"\]$/mu);
});
