import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import test from 'node:test';

const config = readFileSync(
  fileURLToPath(new URL('../../site/.vitepress/config.mts', import.meta.url)),
  'utf8',
);

/** Top-level sidebar group titles, in order: an entry at two-space-deeper indent than `sidebar:`. */
function groups() {
  const block = config.slice(config.indexOf('sidebar: ['), config.indexOf('search:'));
  return [...block.matchAll(/^ {6}\{\n {8}text: '([^']+)'/gmu)].map((match) => match[1]);
}

test('the docs are grouped by what a reader is trying to do', () => {
  assert.deepEqual(groups(), ['Get started', 'Use Lupin', 'Integrations', 'Reference', 'Project']);
});

test('no group hides pages under a catch-all "more" heading', () => {
  assert.doesNotMatch(config, /More product topics/u);
});

test('every guide URL that existed before the regroup is still linked', () => {
  const kept = [
    '/guide/',
    '/guide/install',
    '/guide/getting-started',
    '/guide/sending-results',
    '/guide/concepts',
    '/guide/quality-gates',
    '/guide/profiles',
    '/guide/repository-health',
    '/guide/delivery-performance',
    '/guide/github-command-center',
    '/guide/ai-code',
    '/guide/agents',
    '/guide/issues-and-test-proposals',
    '/guide/cli',
    '/guide/compare',
    '/guide/mcp',
    '/guide/lan-mode',
    '/guide/remote-cloudflare',
    '/guide/notifications',
    '/guide/testing-strategy',
    '/guide/maintenance',
    '/guide/design-language',
    '/guide/glossary',
    '/pages/',
    '/architecture',
    '/operations',
    '/pages/quality/',
    '/pages/capabilities',
    '/pages/quality/findings',
    '/pages/quality/coverage',
    '/pages/quality/ten',
  ];
  for (const link of kept) assert.match(config, new RegExp(`link: '${link}'`, 'u'), link);
});
