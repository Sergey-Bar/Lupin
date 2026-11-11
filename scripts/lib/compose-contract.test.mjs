import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  FRONT_DOOR,
  REQUIRED_OBJECT_STORE_VARIABLES,
  REQUIRED_PRODUCTION_VARIABLES,
  SECURE_FRONT_DOOR,
  bootProblems,
  composeProblems,
  environmentKeys,
  environmentMap,
  frontDoorProblems,
  publishedPorts,
  serviceNames,
  upstreamProblems,
} from './compose-contract.mjs';

/**
 * `pnpm compose:config` cannot catch this class. It resolves interpolation and reports
 * syntax, and a compose file that simply omits `OBJECT_STORE_*` is a perfectly valid
 * compose file. So the committed files are read here instead, and deleting the wiring
 * becomes a failing test rather than a deployment that stops working for whoever tries
 * it next.
 *
 * The two rules are deliberately both present. A production service declaring fewer
 * than the five variables produces a stack that **cannot boot** — the startup policy
 * throws. A declared endpoint naming a service the file does not declare produces a
 * stack that **does** boot and then fails every artifact write with a connection error,
 * which is the worse of the two precisely because it gets further before it fails.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const COMPOSE_FILES = ['infra/compose/docker-compose.unified.yml', 'infra/compose/compose.dev.yml'];

/** @param {string[]} problems @param {RegExp} pattern */
function has(problems, pattern) {
  return problems.some((problem) => pattern.test(problem));
}

test('the extractor reads a mapping environment block', () => {
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      A: "1"',
    '      B: "2"',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')].sort(), ['A', 'B']);
});

test('the extractor reads a list environment block', () => {
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      - A=1',
    '      - B=2',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')].sort(), ['A', 'B']);
});

test('the extractor stops at the end of the environment block', () => {
  // The bug this shape invites: reading on and attributing a sibling block's keys to
  // the service. `ports:` below would otherwise contribute `ports`.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      A: "1"',
    '    ports:',
    '      - "127.0.0.1:53000:3000"',
    '  web:',
    '    environment:',
    '      B: "2"',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')], ['A']);
  assert.deepEqual([...environmentKeys(compose, 'web')], ['B']);
});

test('a service with no environment block has no keys, and is not an error', () => {
  const compose = ['services:', '  worker:', '    restart: "no"', ''].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'worker')], []);
});

test('a value containing a hash is not treated as a comment', () => {
  // Compose values can legitimately contain `#`. Stripping it would corrupt the value
  // and, worse, teach the extractor to report a key whose value it misread.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      # a real comment',
    '      OBJECT_STORE_BUCKET: "bucket#1"',
    '      OTHER: "value" # trailing comment',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')].sort(), ['OBJECT_STORE_BUCKET', 'OTHER']);
});

test('an unparseable line throws rather than returning a partial set', () => {
  // The whole reason this is a parser and not a regular expression. A partial set is
  // indistinguishable from a missing variable, so a silent truncation would report
  // "the variable is absent" for a file that declares it, and the finding would be
  // unactionable.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      GOOD: "1"',
    '      ?? this is not an environment entry ??',
    '',
  ].join('\n');
  assert.throws(() => environmentKeys(compose, 'api'), /unparseable line/);
});

test('service names are read from the services block only', () => {
  const compose = [
    'services:',
    '  postgres:',
    '    image: postgres:16-alpine',
    '  api:',
    '    build: .',
    'volumes:',
    '  data:',
    '',
  ].join('\n');
  assert.deepEqual(serviceNames(compose), ['postgres', 'api']);
});

/**
 * A synthetic compose file with the five object-store variables declared.
 *
 * `OBJECT_STORE_ENDPOINT` gets a real endpoint rather than `"value"` for every variable
 * — the first version of these fixtures set all five to the same string, so the
 * endpoint's host was literally `value`, which the undeclared-service rule correctly
 * flagged. The fixture was wrong, not the rule, and the two failures together were the
 * rule working.
 *
 * @param {{ omit?: string, endpoint?: string, declareMinio?: boolean }} [options]
 */
function composeWithObjectStore({
  omit,
  endpoint = 'http://minio:9000',
  declareMinio = true,
} = {}) {
  return [
    'services:',
    ...(declareMinio ? ['  minio:', '    image: minio/minio'] : []),
    '  api:',
    '    build:',
    '      dockerfile: infra/docker/api.Dockerfile',
    '    environment:',
    '      NODE_ENV: production',
    ...REQUIRED_OBJECT_STORE_VARIABLES.filter((name) => name !== omit).map((name) =>
      name === 'OBJECT_STORE_ENDPOINT' ? `      ${name}: "${endpoint}"` : `      ${name}: "v"`,
    ),
    '',
  ].join('\n');
}

test('a production service missing an object store variable is a finding', () => {
  const problems = composeProblems(
    'x.yml',
    composeWithObjectStore({ omit: 'OBJECT_STORE_BUCKET' }),
  );
  assert.equal(problems.length, 1);
  assert.ok(has(problems, /OBJECT_STORE_BUCKET/));
  assert.ok(has(problems, /startup-policy\.ts/), 'the message must say which check this is');
  assert.ok(
    has(problems, /would not boot/),
    'and what the consequence is, or the reader has to work it out',
  );
});

test('a production service declaring all five is clean', () => {
  assert.deepEqual(composeProblems('x.yml', composeWithObjectStore()), []);
});

test('a development service is not held to the production contract', () => {
  // The dev stack's API is `NODE_ENV: development`, which is why this defect survived in
  // one file and not the other. Holding dev to the production rule would be wrong: the
  // policy genuinely does not apply.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      NODE_ENV: development',
    '',
  ].join('\n');
  assert.deepEqual(composeProblems('x.yml', compose), []);
});

test('an endpoint naming an undeclared service is a finding', () => {
  // The failure that gets further before it fails: the stack boots, and then every
  // artifact write gets a DNS error for a name the compose network cannot resolve.
  const problems = composeProblems(
    'x.yml',
    composeWithObjectStore({ endpoint: 'http://object-store:9000', declareMinio: false }),
  );
  assert.ok(has(problems, /object-store/));
  assert.ok(has(problems, /does not declare as a service/));
});

test('an interpolated or external endpoint host is not treated as a service name', () => {
  // `https://s3.eu-west-1.amazonaws.com` and a `${VAR}` endpoint are legitimate; the
  // rule is about a bare hostname compose would try to resolve on its own network. An
  // interpolated value is the one that got this wrong first: `${OBJECT_STORE_ENDPOINT}`
  // has no dot and no port, so the first version flagged the repository's own
  // production file for an endpoint it resolves at deploy time.
  for (const endpoint of [
    'https://s3.eu-west-1.amazonaws.com',
    '${OBJECT_STORE_ENDPOINT}',
    '${MINIO_HOST:-minio}:9000',
  ]) {
    assert.deepEqual(
      composeProblems('x.yml', composeWithObjectStore({ endpoint, declareMinio: false })),
      [],
      `endpoint ${endpoint}`,
    );
  }
});

for (const file of COMPOSE_FILES) {
  test(`${file} satisfies the object-store contract`, () => {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.deepEqual(
      composeProblems(file, text),
      [],
      'a production service that does not declare the object store cannot start — see ' +
        'apps/api/src/startup-policy.ts and the C-5 row in the findings ledger.',
    );
  });
}

test('the production stack really does declare the object store', () => {
  // Belt and braces, and deliberately explicit rather than derived: this asserts the
  // specific wiring rather than only the absence of a finding, so a change that made
  // the contract vacuously true — no production service at all — still fails.
  const text = readFileSync(
    path.join(REPO_ROOT, 'infra/compose/docker-compose.unified.yml'),
    'utf8',
  );
  const keys = environmentKeys(text, 'api');
  for (const name of REQUIRED_OBJECT_STORE_VARIABLES) {
    assert.ok(keys.has(name), `infra/compose/docker-compose.unified.yml api must declare ${name}`);
  }
  assert.equal(
    keys.has('NODE_ENV'),
    true,
    'the api service must still claim to be production, or this file is testing nothing',
  );
  assert.ok(
    serviceNames(text).includes('objectstore'),
    'the production stack must declare the object store service the endpoint names',
  );
});

// ─── First boot on a clean machine (ledger MNT-19 onward) ──────────────────────────

/** @param {string} relative */
function readRepo(relative) {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

test('pull_policy: never, an untagged image and :latest are each a finding', () => {
  const compose = [
    'services:',
    '  a:',
    '    image: example/a:1.2.3',
    '    pull_policy: never',
    '  b:',
    '    image: example/b',
    '  c:',
    '    image: example/c:latest',
    '  d:',
    '    image: ghcr.io/owner/d:${LUPIN_VERSION:?set LUPIN_VERSION}',
    '',
  ].join('\n');
  const problems = bootProblems('x.yml', compose);
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.ok(has(problems, /`a` sets pull_policy: never/));
  assert.ok(has(problems, /`b` uses image `example\/b` with no tag/));
  assert.ok(has(problems, /example\/c:latest/));
});

test('a production API missing a boot variable is a finding naming it', () => {
  const compose = [
    'services:',
    '  api:',
    '    build:',
    '      dockerfile: infra/docker/api.Dockerfile',
    '    environment:',
    '      NODE_ENV: production',
    ...REQUIRED_PRODUCTION_VARIABLES.filter((name) => name !== 'LUPIN_INSTALLATION_KEY').map(
      (name) => `      ${name}: v`,
    ),
    '',
  ].join('\n');
  const problems = bootProblems('x.yml', compose);
  assert.equal(problems.length, 1);
  assert.ok(has(problems, /LUPIN_INSTALLATION_KEY/));
});

test('the boot variables are exactly the ones the API refuses to start without', () => {
  // Derived in both directions from the two files that refuse, so the list cannot invent a
  // requirement and cannot miss a new one.
  const policy = readRepo('apps/api/src/startup-policy.ts');
  const index = readRepo('apps/api/src/index.ts');
  const refused = new Set([
    ...[...policy.matchAll(/refuseIfUnusable\('([A-Z_]+)'/g)].map((match) => match[1] ?? ''),
    ...(/DATABASE_URL is required in production/.test(policy) ? ['DATABASE_URL'] : []),
    ...[...index.matchAll(/process\.env\['(LUPIN_INSTALLATION_KEY)'\]/g)].map(
      (match) => match[1] ?? '',
    ),
  ]);
  assert.deepEqual([...refused].sort(), [...REQUIRED_PRODUCTION_VARIABLES].sort());
});

test('an upstream on a port its target does not listen on is a finding', () => {
  const conf = 'upstream w { server web:80; }\nupstream a { server api:3000; }\n';
  const listening = new Map([
    ['web', 8080],
    ['api', 3000],
  ]);
  const problems = upstreamProblems('edge.conf', conf, listening);
  assert.equal(problems.length, 1);
  assert.ok(has(problems, /web:80, but web listens on 8080/));
});

for (const file of COMPOSE_FILES) {
  test(`${file} can start on a machine that has never run it`, () => {
    assert.deepEqual(bootProblems(file, readRepo(file)), []);
  });
}

test('the edge proxy reaches each upstream on the port it listens on', () => {
  const webListen = /listen\s+(\d+)/.exec(readRepo('infra/nginx/web.conf'));
  assert.ok(webListen !== null, 'infra/nginx/web.conf declares no listen port');
  const apiPort = environmentMap(readRepo('infra/compose/compose.dev.yml'), 'api').get('PORT');
  const listening = new Map([
    ['web', Number(webListen[1])],
    ['api', Number(apiPort)],
  ]);
  assert.deepEqual(
    upstreamProblems('infra/nginx/edge.conf', readRepo('infra/nginx/edge.conf'), listening),
    [],
  );
});

test('both nginx images keep their temp files on the /tmp tmpfs (MNT-23)', () => {
  // `web` and `edge` run read-only as `nginx` with a tmpfs over /var/cache/nginx. The
  // tmpfs is root-owned and hides the directory the Dockerfile chowned, so nginx's
  // compiled-in temp paths under it failed `mkdir` and the container exited on start.
  for (const conf of ['infra/nginx/web.conf', 'infra/nginx/edge.conf']) {
    const text = readRepo(conf);
    for (const directive of ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) {
      assert.match(
        text,
        new RegExp(`^${directive}_temp_path\\s+/tmp/`, 'm'),
        `${conf} must set ${directive}_temp_path under /tmp`,
      );
    }
  }
});

test('both nginx images fail the build if the pid rewrite stops matching (MNT-23)', () => {
  // The rewrite targeted `/var/run/nginx.pid`; nginx 1.27 writes `/run/nginx.pid`, so `sed`
  // matched nothing, the build passed, and the read-only container could not write its pid.
  for (const dockerfile of ['infra/docker/web.Dockerfile', 'infra/docker/edge.Dockerfile']) {
    assert.match(
      readRepo(dockerfile),
      /grep -q '\^pid \/tmp\/nginx\.pid;' \/etc\/nginx\/nginx\.conf/,
      `${dockerfile} must verify the pid rewrite`,
    );
  }
});

// ─── One front door ─────────────────────────────────────────────────────────────────

test('a second published port, or no front door, is a finding', () => {
  const compose = [
    'services:',
    '  postgres:',
    '    ports:',
    "      - '127.0.0.1:55432:5432'",
    '  edge:',
    '    ports:',
    `      - '${FRONT_DOOR}'`,
    '',
  ].join('\n');
  const problems = frontDoorProblems('x.yml', compose);
  assert.equal(problems.length, 1);
  assert.ok(has(problems, /`postgres` publishes `127\.0\.0\.1:55432:5432`/));
  assert.ok(has(frontDoorProblems('x.yml', 'services:\n  api:\n    image: a:1\n'), /no `edge`/));
});

test('the production stack publishes only the edge proxy, on loopback by default', () => {
  const text = readRepo('infra/compose/docker-compose.unified.yml');
  assert.deepEqual(frontDoorProblems('infra/compose/docker-compose.unified.yml', text), []);
  assert.match(FRONT_DOOR, /^\$\{LUPIN_BIND:-127\.0\.0\.1\}:/);
  // The HTTPS door is the same proxy on the same bind, so it widens nothing LAN mode did not.
  assert.match(SECURE_FRONT_DOOR, /^\$\{LUPIN_BIND:-127\.0\.0\.1\}:/);
  assert.deepEqual(publishedPorts(text, 'edge'), [FRONT_DOOR, SECURE_FRONT_DOOR]);
});

test('the HTTPS door is the edge only, never a second service', () => {
  const compose = [
    'services:',
    '  api:',
    '    ports:',
    `      - '${SECURE_FRONT_DOOR}'`,
    '  edge:',
    '    ports:',
    `      - '${FRONT_DOOR}'`,
    '',
  ].join('\n');
  assert.ok(has(frontDoorProblems('x.yml', compose), /`api` publishes/));
});

// ─── Images are pinned by digest, and something moves the digest (ledger MNT-196) ─────

const DIGEST_PINNED = /^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/u;

/** @param {string} text @returns {string[]} every `image:` value, quotes removed */
function imagesIn(text) {
  return [...text.matchAll(/^\s+image:\s*['"]?([^'"\s#]+)['"]?/gmu)].map((match) => match[1] ?? '');
}

test('the image extractor reads an image, quoted or not, and a digest pin is recognised', () => {
  assert.deepEqual(imagesIn('services:\n  db:\n    image: "postgres:16"\n'), ['postgres:16']);
  assert.ok(DIGEST_PINNED.test(`postgres:16-alpine@sha256:${'a'.repeat(64)}`));
  assert.ok(!DIGEST_PINNED.test('postgres:16-alpine'));
});

test('every third-party compose image is pinned by tag and digest', () => {
  // A tag is a pointer the publisher can move; the digest is the bytes that were reviewed.
  // The images this repository builds are named by `${…}` and are the release's to pin.
  const unpinned = COMPOSE_FILES.flatMap((file) =>
    imagesIn(readFileSync(path.join(REPO_ROOT, file), 'utf8'))
      .filter((image) => !image.startsWith('${') && !DIGEST_PINNED.test(image))
      .map((image) => `${file}: ${image}`),
  );
  assert.deepEqual(unpinned, []);
});

test('the CI database is the compose database, digest and all', () => {
  // Dependabot updates compose files and cannot update a workflow's service image, so the
  // workflows are held to the compose pin and move with it.
  const compose = imagesIn(
    readFileSync(path.join(REPO_ROOT, 'infra/compose/docker-compose.unified.yml'), 'utf8'),
  ).find((image) => image.startsWith('postgres:'));
  assert.ok(compose !== undefined, 'the production stack declares no postgres image');
  const workflows = ['nightly.yml', 'unified-ci.yml'];
  const drift = workflows.flatMap((name) =>
    imagesIn(readFileSync(path.join(REPO_ROOT, '.github/workflows', name), 'utf8'))
      .filter((image) => image.startsWith('postgres:') && image !== compose)
      .map((image) => `${name}: ${image}`),
  );
  assert.deepEqual(drift, []);
});

test('dependabot watches the compose files, so a digest does not go stale', () => {
  const config = readFileSync(path.join(REPO_ROOT, '.github/dependabot.yml'), 'utf8');
  const block = config.slice(config.indexOf("package-ecosystem: 'docker-compose'"));
  assert.ok(config.includes("package-ecosystem: 'docker-compose'"), 'no docker-compose ecosystem');
  assert.ok(
    block.includes("'/infra/compose'"),
    'the docker-compose ecosystem misses /infra/compose',
  );
});

// ─── A reboot brings the stack back, and no service starves another (ledger MNT-197) ─────

/**
 * The top-level keys of each service in a compose file.
 *
 * @param {string} text
 * @returns {Map<string, Set<string>>}
 */
function serviceKeysIn(text) {
  /** @type {Map<string, Set<string>>} */
  const services = new Map();
  let inServices = false;
  /** @type {Set<string> | null} */
  let current = null;
  for (const line of text.split(/\r?\n/u)) {
    if (/^\S/u.test(line)) {
      inServices = line.startsWith('services:');
      current = null;
      continue;
    }
    if (!inServices) continue;
    const service = /^ {2}([a-z][\w-]*):\s*$/u.exec(line);
    if (service !== null) {
      current = new Set();
      services.set(service[1] ?? '', current);
      continue;
    }
    const key = /^ {4}([a-z_]+):/u.exec(line);
    if (key !== null && current !== null) current.add(key[1] ?? '');
  }
  return services;
}

test('the service-key reader sees each service and only its own keys', () => {
  const compose = [
    'services:',
    '  a:',
    '    restart: unless-stopped',
    '    environment:',
    '      mem_limit: not-a-key',
    '  b:',
    '    cpus: 1',
    'volumes:',
    '  c:',
    '    driver: local',
    '',
  ].join('\n');
  const keys = serviceKeysIn(compose);
  assert.deepEqual([...keys.keys()], ['a', 'b']);
  assert.deepEqual([...(keys.get('a') ?? [])], ['restart', 'environment']);
});

test('every long-running service restarts, and has a memory and a CPU limit', () => {
  const text = readFileSync(
    path.join(REPO_ROOT, 'infra/compose/docker-compose.unified.yml'),
    'utf8',
  );
  const services = serviceKeysIn(text);
  assert.ok(services.size >= 8, 'read too few services to mean anything');
  const problems = [];
  for (const [name, keys] of services) {
    if (name === 'migrate') continue; // one-shot: `restart: 'no'` is the point of it
    for (const required of ['restart', 'mem_limit', 'cpus']) {
      if (!keys.has(required)) problems.push(`${name}: no ${required}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every long-running image says how to tell it is healthy', () => {
  // The migration image runs once and exits; every other image is a service a restart
  // policy and `depends_on: service_healthy` need a health signal from.
  const missing = ['api', 'worker', 'runner', 'web', 'edge'].filter(
    (image) =>
      !/^HEALTHCHECK /mu.test(
        readFileSync(path.join(REPO_ROOT, `infra/docker/${image}.Dockerfile`), 'utf8'),
      ),
  );
  assert.deepEqual(missing, []);
});
