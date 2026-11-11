import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * The guides name what the product accepts (ledger MNT-181). The upload guide listed four
 * formats while the door read five, and the reports guide left out email, which the dispatcher
 * sends; both lists are read here from the contracts that define them, so a format or a
 * channel added to the code without a line in its guide fails.
 */
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

/** The first spelling of every upload format but the legacy wire shape. */
function uploadFormats() {
  const source = read('packages/shared-contracts/src/schemas/report-formats.ts');
  const table = source.slice(source.indexOf('export const REPORT_FORMATS'));
  return [...table.matchAll(/spellings: \[\s*'([^']+)'/gu)].map((match) => match[1]);
}

function channelKinds() {
  const source = read('packages/shared-contracts/src/schemas/notifications.ts');
  const list = source.match(/CHANNEL_KINDS = \[([^\]]+)\]/u)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

test('the contracts are read, so this test can fail', () => {
  assert.ok(uploadFormats().length >= 5, 'could not read REPORT_FORMATS');
  assert.ok(channelKinds().length >= 7, 'could not read CHANNEL_KINDS');
});

test('the upload guide names every format the upload door reads', () => {
  const guide = read('site/guide/sending-results.md');
  for (const format of uploadFormats()) {
    assert.ok(guide.includes(`\`${format}\``), `site/guide/sending-results.md omits ${format}`);
  }
});

test('the reports guide names every channel the dispatcher sends to', () => {
  const guide = read('site/guide/notifications.md').toLowerCase();
  const names = { teams: 'microsoft teams', inbox: 'inbox' };
  for (const kind of channelKinds()) {
    const name = names[kind] ?? kind;
    assert.ok(guide.includes(name), `site/guide/notifications.md omits ${kind}`);
  }
});

test('the CLI guide shows every command the CLI has', () => {
  const source = read('tools/lupin-cli/src/cli.ts');
  const table = source.slice(source.indexOf('const COMMANDS'));
  const block = table.slice(0, table.indexOf('};'));
  const commands = [...block.matchAll(/^\s+'?([a-z-]+)'?[:,]/gmu)].map((match) => match[1]);
  assert.ok(commands.length >= 9, 'could not read COMMANDS');
  const guide = read('site/guide/cli.md');
  for (const command of commands) {
    assert.ok(guide.includes(`lupin ${command}`), `site/guide/cli.md omits lupin ${command}`);
  }
});
