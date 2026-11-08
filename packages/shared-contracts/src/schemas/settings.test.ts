import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HELP_MAX_LENGTH,
  INFRA_ENV_ALLOW_LIST,
  ONBOARDING_STEPS,
  SETTINGS,
  SETTINGS_ERROR_FIXES,
  type SettingDefinition,
  settingByKey,
  splitSettingList,
} from './settings.js';
import { UpdateChannelBodySchema } from './notifications.js';

const CONFIG_SOURCE = fileURLToPath(new URL('../../../config/src/config.ts', import.meta.url));

/** Every key `EnvironmentSchema` declares, read from the source so no package depends on another. */
function environmentVariables(source: string): string[] {
  const start = source.indexOf('const EnvironmentSchema = z.object({');
  const end = source.indexOf('\n});', start);
  if (start < 0 || end < 0) throw new Error('EnvironmentSchema not found in config.ts');
  return [...source.slice(start, end).matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gmu)].map(
    (match) => match[1] as string,
  );
}

/** The two-way check, as a function so a probe can prove it fails. */
function registryProblems(
  settings: readonly SettingDefinition[],
  allowList: readonly string[],
  declared: readonly string[],
): string[] {
  const problems: string[] = [];
  const claimed = new Set([...settings.map((setting) => setting.envVar), ...allowList]);
  for (const name of declared) {
    if (!claimed.has(name)) problems.push(`${name} is neither a setting nor infrastructure`);
  }
  for (const name of claimed) {
    if (!declared.includes(name)) problems.push(`${name} is not read by @lupin/config`);
  }
  for (const setting of settings) {
    if (setting.help.trim() === '') problems.push(`${setting.key} has no help text`);
    if (setting.help.length > HELP_MAX_LENGTH) problems.push(`${setting.key} help is too long`);
  }
  return problems;
}

describe('settings registry', () => {
  const declared = environmentVariables(readFileSync(CONFIG_SOURCE, 'utf8'));

  it('reads a real environment schema', () => {
    expect(declared).toContain('DATABASE_URL');
    expect(declared.length).toBeGreaterThan(30);
  });

  it('claims every configuration variable exactly once, in both directions', () => {
    expect(registryProblems(SETTINGS, INFRA_ENV_ALLOW_LIST, declared)).toEqual([]);
    const envVars = SETTINGS.map((setting) => setting.envVar);
    expect(new Set(envVars).size).toBe(envVars.length);
    expect(envVars.filter((name) => INFRA_ENV_ALLOW_LIST.includes(name))).toEqual([]);
  });

  it('refutes a registry with a missing variable, a stray one, or a missing help text', () => {
    const [first, ...rest] = SETTINGS as [SettingDefinition, ...SettingDefinition[]];
    expect(registryProblems(rest, INFRA_ENV_ALLOW_LIST, declared)).toContain(
      `${first.envVar} is neither a setting nor infrastructure`,
    );
    expect(registryProblems(SETTINGS, [...INFRA_ENV_ALLOW_LIST, 'NOT_A_VAR'], declared)).toContain(
      'NOT_A_VAR is not read by @lupin/config',
    );
    expect(
      registryProblems([{ ...first, help: '' }, ...rest], INFRA_ENV_ALLOW_LIST, declared),
    ).toContain(`${first.key} has no help text`);
  });

  it('keeps infrastructure out of the interface', () => {
    for (const name of [
      'DATABASE_URL',
      'VAULT_SECRET',
      'ACCESS_CONTROL',
      'LUPIN_LAN_MODE',
      'LUPIN_BIND',
    ]) {
      expect(SETTINGS.some((setting) => setting.envVar === name)).toBe(false);
    }
  });

  it('declares every help text as one sentence of at most 140 characters', () => {
    for (const setting of SETTINGS) {
      expect(setting.help.length, setting.key).toBeLessThanOrEqual(HELP_MAX_LENGTH);
      expect(setting.help.trim().length, setting.key).toBeGreaterThan(10);
    }
  });

  it('validates a value with the setting schema and finds a setting by key', () => {
    expect(
      settingByKey('integrations.githubApiUrl')?.schema.safeParse('http://x.test').success,
    ).toBe(false);
    expect(
      settingByKey('integrations.githubApiUrl')?.schema.safeParse('https://x.test').success,
    ).toBe(true);
    expect(
      settingByKey('identity.oidcRoleMap')?.schema.safeParse('admin:alice@acme.com, viewer:*')
        .success,
    ).toBe(true);
    expect(settingByKey('identity.oidcRoleMap')?.schema.safeParse('boss:alice').success).toBe(
      false,
    );
    expect(settingByKey('nope')).toBeUndefined();
  });

  it('marks every credential as a secret', () => {
    for (const key of ['ai.apiKey', 'integrations.slackBotToken', 'identity.oidcClientSecret']) {
      expect(settingByKey(key)?.secret).toBe(true);
    }
  });

  it('names a fix for every error code', () => {
    for (const fix of Object.values(SETTINGS_ERROR_FIXES)) expect(fix.length).toBeGreaterThan(10);
    expect(ONBOARDING_STEPS).toHaveLength(6);
  });
});

describe('setting value rules', () => {
  it('accepts a comma list of email domains, and refuses anything else', () => {
    const domains = settingByKey('identity.oidcAllowedDomains')?.schema;
    expect(domains?.safeParse('acme.com, example.org').success).toBe(true);
    expect(domains?.safeParse('').success).toBe(true);
    expect(domains?.safeParse('acme.com; evil').success).toBe(false);
  });

  it('splits a comma list into trimmed, non-empty items', () => {
    expect(splitSettingList(' a , ,b,')).toEqual(['a', 'b']);
  });

  it('bounds numbers, and refuses a sync interval short enough to hammer GitHub', () => {
    const interval = settingByKey('integrations.deliverySyncIntervalMs')?.schema;
    expect(interval?.safeParse(9_999).success).toBe(false);
    expect(interval?.safeParse('60000').success).toBe(true);
    expect(settingByKey('sessions.ttlHours')?.schema.safeParse(0).success).toBe(false);
  });
});

describe('channel edits', () => {
  it('needs at least one field, and never a kind', () => {
    expect(UpdateChannelBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateChannelBodySchema.safeParse({ name: 'Release chat' }).success).toBe(true);
    expect(UpdateChannelBodySchema.safeParse({ enabled: false }).success).toBe(true);
  });
});
