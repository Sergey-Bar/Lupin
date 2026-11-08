import { eq } from 'drizzle-orm';
import { installationSettings } from '@lupin/db';
import {
  SETTINGS,
  SETTINGS_ERROR_FIXES,
  settingByKey,
  type SettingDefinition,
  type SettingRead,
  type SettingScope,
} from '@lupin/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { audit } from './access-service.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';
import { deleteVaultSecret, readVaultSecret, storeVaultSecret } from './vault-secrets.js';

/**
 * The settings resolver: environment > saved value > default, for every key the registry in
 * `@lupin/shared-contracts` declares.
 *
 * The one place a product setting is read. A consumer asks {@link SettingsService.resolve}
 * and gets the value in effect *now*, so a change saved from the interface applies on the
 * next request without a restart. Saved values are cached, and the cache is dropped on every
 * write this service makes.
 *
 * A secret setting is sealed in the vault under `setting:<key>` in the installation's home
 * workspace; the settings row holds only `{ sealed: true, last4 }`. Every read model masks it,
 * and only `resolve` — in process — opens it.
 */
export type SettingValue = string | number | boolean;

export interface SettingsServiceOptions {
  /** Absent: environment and defaults only, and every write is refused. */
  db?: ProjectRegistryServiceOptions['db'];
  /** The installation's home workspace: where secret settings are sealed. */
  workspaceId: string;
  vaultSecret?: string | undefined;
  env: Record<string, string | undefined>;
}

export interface SettingsService {
  read(key: string): Promise<SettingRead>;
  list(scope?: SettingScope): Promise<SettingRead[]>;
  /** The value in effect, secrets opened. In process only: never put this in a response. */
  resolve(key: string): Promise<SettingValue | undefined>;
  put(key: string, value: SettingValue, actor: string): Promise<SettingRead>;
  revert(key: string, actor: string): Promise<SettingRead>;
  /** Whether an environment variable pins `key`, and which. */
  lockedBy(key: string): string | null;
  /** Called with the key after every save or revert through this service. Returns an unsubscribe. */
  subscribe(listener: (key: string) => void): () => void;
}

interface StoredRow {
  value: SettingValue | null;
  sealed: boolean;
  last4: string | null;
  updatedAt: string;
  updatedBy: string;
}

const TRUE = new Set(['1', 'true', 'yes']);

function definitionOf(key: string): SettingDefinition {
  const definition = settingByKey(key);
  if (definition === undefined) {
    throw new DomainError(ErrorCode.UNKNOWN_SETTING, `There is no setting called ${key}.`, {
      details: { key, fix: SETTINGS_ERROR_FIXES.UNKNOWN_SETTING },
    });
  }
  return definition;
}

function fromEnvironment(definition: SettingDefinition, raw: string): SettingValue {
  if (definition.kind === 'boolean') return TRUE.has(raw.trim().toLowerCase());
  if (definition.kind === 'integer') {
    const number = Number(raw);
    return Number.isFinite(number) ? number : raw;
  }
  return raw;
}

function vaultName(key: string): string {
  return `setting:${key}`;
}

export function createSettingsService(options: SettingsServiceOptions): SettingsService {
  let cache: Map<string, StoredRow> | null = null;
  const opened = new Map<string, string>();
  const listeners = new Set<(key: string) => void>();

  const envValue = (definition: SettingDefinition): string | undefined => {
    const raw = options.env[definition.envVar];
    return raw === undefined || raw.trim() === '' ? undefined : raw;
  };

  async function stored(): Promise<Map<string, StoredRow>> {
    if (cache !== null) return cache;
    const next = new Map<string, StoredRow>();
    if (options.db !== undefined) {
      for (const row of await options.db.select().from(installationSettings)) {
        const value = (row.value ?? {}) as {
          value?: SettingValue;
          sealed?: boolean;
          last4?: string;
        };
        next.set(row.key, {
          value: value.value ?? null,
          sealed: value.sealed === true,
          last4: value.last4 ?? null,
          updatedAt: row.updatedAt.toISOString(),
          updatedBy: row.updatedBy,
        });
      }
    }
    cache = next;
    return next;
  }

  function invalidate(key: string): void {
    cache = null;
    opened.delete(key);
    for (const listener of [...listeners]) {
      try {
        listener(key);
      } catch {
        // One consumer failing to follow a change must not stop the others, or the save.
      }
    }
  }

  function subscribe(listener: (key: string) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function requireDb(): NonNullable<SettingsServiceOptions['db']> {
    if (options.db === undefined) {
      throw new DomainError(
        ErrorCode.NOT_CONFIGURED,
        'Settings can only be saved with a database.',
        {
          callerSafe: true,
          details: { fix: 'Set DATABASE_URL on the API and restart it.' },
        },
      );
    }
    return options.db;
  }

  function vaultOptions(actor?: string) {
    return {
      db: requireDb(),
      workspaceId: options.workspaceId,
      vaultSecret: options.vaultSecret,
      ...(actor === undefined ? {} : { actor }),
    };
  }

  async function read(key: string): Promise<SettingRead> {
    const definition = definitionOf(key);
    const fromEnv = envValue(definition);
    if (fromEnv !== undefined) {
      return {
        key,
        source: 'environment',
        value: definition.secret ? null : fromEnvironment(definition, fromEnv),
        ...(definition.secret ? { secret: { set: true, last4: fromEnv.slice(-4) } } : {}),
        updatedAt: null,
        updatedBy: null,
      };
    }
    const row = (await stored()).get(key);
    if (row !== undefined) {
      return {
        key,
        source: 'ui',
        value: definition.secret ? null : row.value,
        ...(definition.secret ? { secret: { set: row.sealed, last4: row.last4 } } : {}),
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    }
    const fallback = definition.defaultValue;
    return {
      key,
      source: fallback === undefined ? 'unset' : 'default',
      value: definition.secret ? null : (fallback ?? null),
      ...(definition.secret ? { secret: { set: false, last4: null } } : {}),
      updatedAt: null,
      updatedBy: null,
    };
  }

  async function resolve(key: string): Promise<SettingValue | undefined> {
    const definition = definitionOf(key);
    const fromEnv = envValue(definition);
    if (fromEnv !== undefined) return fromEnvironment(definition, fromEnv);
    const row = (await stored()).get(key);
    if (row === undefined) return definition.defaultValue;
    if (!definition.secret) return row.value ?? definition.defaultValue;
    const cached = opened.get(key);
    if (cached !== undefined) return cached;
    const secret = await readVaultSecret(vaultOptions(), vaultName(key), definition.label);
    if (secret === null) return undefined;
    opened.set(key, secret);
    return secret;
  }

  function lockedBy(key: string): string | null {
    const definition = definitionOf(key);
    return envValue(definition) === undefined ? null : definition.envVar;
  }

  async function put(key: string, value: SettingValue, actor: string): Promise<SettingRead> {
    const definition = definitionOf(key);
    const lock = lockedBy(key);
    if (lock !== null) {
      throw new DomainError(
        ErrorCode.ENV_LOCKED,
        `${definition.label} is set by the environment (${lock}).`,
        {
          details: { key, envVar: lock, fix: SETTINGS_ERROR_FIXES.ENV_LOCKED },
        },
      );
    }
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new DomainError(
        ErrorCode.INVALID_SETTING,
        parsed.error.issues[0]?.message ?? `${definition.label} is not valid.`,
        { details: { key, fix: SETTINGS_ERROR_FIXES.INVALID_SETTING } },
      );
    }
    const db = requireDb();
    const clean = parsed.data as SettingValue;
    let stored: Record<string, unknown> = { value: clean };
    if (definition.secret) {
      if (options.vaultSecret === undefined) {
        throw new DomainError(
          ErrorCode.NOT_CONFIGURED,
          `${definition.label} can only be stored once VAULT_SECRET is configured.`,
          {
            callerSafe: true,
            details: { key, fix: SETTINGS_ERROR_FIXES.VAULT_NOT_CONFIGURED },
          },
        );
      }
      const text = String(clean);
      await storeVaultSecret(vaultOptions(actor), vaultName(key), text, definition.label);
      stored = { sealed: true, last4: text.slice(-4) };
    }
    const now = new Date();
    await db
      .insert(installationSettings)
      .values({ key, value: stored, updatedBy: actor, updatedAt: now })
      .onConflictDoUpdate({
        target: installationSettings.key,
        set: { value: stored, updatedBy: actor, updatedAt: now },
      });
    invalidate(key);
    await audit(
      { db, workspaceId: options.workspaceId },
      { actor, action: 'setting.update', resourceType: 'setting', resourceId: key },
    );
    return read(key);
  }

  async function revert(key: string, actor: string): Promise<SettingRead> {
    const definition = definitionOf(key);
    const db = requireDb();
    await db.delete(installationSettings).where(eq(installationSettings.key, key));
    if (definition.secret) await deleteVaultSecret(vaultOptions(actor), vaultName(key));
    invalidate(key);
    await audit(
      { db, workspaceId: options.workspaceId },
      { actor, action: 'setting.revert', resourceType: 'setting', resourceId: key },
    );
    return read(key);
  }

  async function list(scope?: SettingScope): Promise<SettingRead[]> {
    const keys = SETTINGS.filter((setting) => scope === undefined || setting.scope === scope);
    return Promise.all(keys.map((setting) => read(setting.key)));
  }

  return { read, list, resolve, put, revert, lockedBy, subscribe };
}
