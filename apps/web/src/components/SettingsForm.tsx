import React from 'react';
import { Badge, Button, Input, Lock, Select, Toggle } from '@lupin/ui';
import {
  SETTINGS,
  type SettingDefinition,
  type SettingGroup,
  type SettingRead,
  type SettingTestResult,
} from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { ago } from '../lib/health-view.js';
import { explain, SettingsApiError, type SettingsClient } from '../lib/settings-client.js';
import { useToast } from './Toasts.js';

/**
 * One settings group as a form, drawn from the registry in `@lupin/shared-contracts`.
 *
 * Every field says three things a person needs before they change it: what it does (the
 * registry's one-sentence `help`), where its current value came from (environment, saved here,
 * or the default), and — for a secret — whether one is stored, without ever showing it.
 * A field an environment variable sets is shown locked with the variable's name, because the
 * API refuses to save over it and a field that looks editable but fails is worse than one
 * that says why it is not.
 */
type Draft = Record<string, string | boolean>;

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer — can read everything' },
  { value: 'operator', label: 'Operator — can also start runs' },
  { value: 'admin', label: 'Admin — can also change settings' },
  { value: 'none', label: 'Nobody — only the people listed' },
];

function initial(definition: SettingDefinition, read: SettingRead | undefined): string | boolean {
  if (definition.secret) return '';
  const value = read?.value ?? definition.defaultValue ?? null;
  if (definition.kind === 'boolean') return value === true;
  return value === null ? '' : String(value);
}

function typed(definition: SettingDefinition, value: string | boolean): string | number | boolean {
  if (definition.kind === 'boolean') return value === true;
  if (definition.kind === 'integer') return Number(value);
  return String(value).trim();
}

function SourceNote({
  definition,
  read,
}: {
  definition: SettingDefinition;
  read: SettingRead | undefined;
}) {
  if (read?.source === 'environment') {
    return (
      <p
        className="flex items-center gap-1.5 text-xs text-fg-muted"
        data-testid={`locked-${definition.key}`}
      >
        <Lock aria-hidden className="size-3.5 shrink-0" />
        <span>
          Set by environment (<span className="font-mono">{definition.envVar}</span>). Change it
          there, or remove it and restart the API to edit it here.
        </span>
      </p>
    );
  }
  if (read?.source === 'ui') {
    return (
      <p className="text-xs text-fg-muted">
        Saved{read.updatedAt === null ? '' : ` ${ago(read.updatedAt)}`}
        {read.updatedBy === null ? '' : ` by ${read.updatedBy}`}.
      </p>
    );
  }
  if (read?.source === 'default')
    return <p className="text-xs text-fg-muted">Using the default.</p>;
  return <p className="text-xs text-fg-muted">Not set.</p>;
}

function Field({
  definition,
  read,
  value,
  onChange,
  replacing,
  onReplace,
  disabled,
}: {
  definition: SettingDefinition;
  read: SettingRead | undefined;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  replacing: boolean;
  onReplace: () => void;
  disabled: boolean;
}): React.ReactElement {
  const id = `setting-${definition.key.replace(/\./gu, '-')}`;
  const locked = read?.source === 'environment' || disabled;
  const label =
    definition.unit === undefined ? definition.label : `${definition.label} (${definition.unit})`;
  const storedSecret = definition.secret && read?.secret?.set === true;
  let control: React.ReactNode;
  if (definition.kind === 'boolean') {
    control = (
      <Toggle
        id={id}
        label={definition.label}
        checked={value === true}
        disabled={locked}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  } else if (definition.kind === 'role') {
    control = (
      <Select
        id={id}
        label={label}
        value={String(value)}
        disabled={locked}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.value)}
        options={ROLE_OPTIONS}
      />
    );
  } else if (storedSecret && !replacing) {
    control = (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-fg" id={`${id}-label`}>
          {label}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid={`secret-${definition.key}`}>
            Saved · ending {read?.secret?.last4 ?? '····'}
          </Badge>
          {locked ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReplace}
              aria-describedby={`${id}-label`}
            >
              Replace
            </Button>
          )}
        </div>
      </div>
    );
  } else {
    control = (
      <Input
        id={id}
        label={label}
        value={String(value)}
        disabled={locked}
        aria-describedby={`${id}-help`}
        type={definition.secret ? 'password' : definition.kind === 'integer' ? 'number' : 'text'}
        inputMode={definition.kind === 'integer' ? 'numeric' : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={
          definition.defaultValue === undefined ? undefined : String(definition.defaultValue)
        }
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <div className="grid gap-1.5" data-testid={`field-${definition.key}`}>
      {control}
      <p id={`${id}-help`} className="text-sm text-pretty text-fg-muted">
        {definition.help}
        {definition.apply === 'next-sign-in' ? ' Applies from the next sign-in.' : ''}
      </p>
      <SourceNote definition={definition} read={read} />
    </div>
  );
}

export function SettingsForm({
  client,
  group,
  title,
  canEdit,
  testKey,
  onSaved,
  onSubmitValues,
  submitLabel,
}: {
  client: SettingsClient;
  group: SettingGroup;
  /** The form's accessible name. */
  title: string;
  /** False for a workspace admin: the fields are shown, and say who can change them. */
  canEdit: boolean;
  /** The key whose tester checks this group, or absent for a group with no live test. */
  testKey?: string;
  onSaved?: () => void;
  /**
   * Takes the changed values instead of saving them one by one: Identity saves a draft and
   * tests it first. Empty strings mean "clear this setting".
   */
  onSubmitValues?: (values: Record<string, string | number | boolean>) => Promise<void>;
  /** The submit button's label when there are changes. */
  submitLabel?: string;
}): React.ReactElement {
  const toast = useToast();
  const [version, setVersion] = React.useState(0);
  const reads = useResource(() => client.listSettings(), [client, version]);
  const definitions = React.useMemo(
    () => SETTINGS.filter((setting) => setting.group === group),
    [group],
  );
  // Only what the person changed. Everything else is read from the server's answer, so a field
  // never shows empty for a frame between the answer arriving and a copy of it being made.
  const [edits, setEdits] = React.useState<Draft>({});
  const [replacing, setReplacing] = React.useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<SettingTestResult | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const byKey = React.useMemo(() => {
    const map = new Map<string, SettingRead>();
    if (reads.status === 'ready') for (const read of reads.value) map.set(read.key, read);
    return map;
  }, [reads]);

  if (reads.status === 'loading') {
    return (
      <p role="status" className="text-sm text-fg-muted">
        Reading settings…
      </p>
    );
  }
  if (reads.status === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        Settings could not be read: {reads.message}
      </p>
    );
  }

  const draft: Draft = {};
  for (const definition of definitions) {
    draft[definition.key] = edits[definition.key] ?? initial(definition, byKey.get(definition.key));
  }
  const dirty = definitions.filter((definition) => {
    const now = draft[definition.key];
    if (now === undefined || byKey.get(definition.key)?.source === 'environment') return false;
    if (definition.secret) return typeof now === 'string' && now.trim() !== '';
    return now !== initial(definition, byKey.get(definition.key));
  });

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    if (onSubmitValues !== undefined) {
      const values: Record<string, string | number | boolean> = {};
      for (const definition of dirty) {
        const raw = draft[definition.key] ?? '';
        values[definition.key] =
          definition.kind !== 'boolean' && String(raw).trim() === '' ? '' : typed(definition, raw);
      }
      try {
        await onSubmitValues(values);
      } catch (error) {
        toast({
          tone: 'danger',
          title: 'The changes were not saved',
          description: explain(error, 'The request failed.'),
        });
      } finally {
        setSaving(false);
      }
      return;
    }
    const failed: Record<string, string> = {};
    for (const definition of dirty) {
      const raw = draft[definition.key] ?? '';
      try {
        if (definition.kind !== 'boolean' && String(raw).trim() === '') {
          await client.revertSetting(definition.key);
        } else {
          await client.putSetting(definition.key, typed(definition, raw));
        }
      } catch (error) {
        failed[definition.key] = explain(error, 'The setting could not be saved.');
      }
    }
    setSaving(false);
    setErrors(failed);
    const saved = dirty.length - Object.keys(failed).length;
    if (saved > 0) {
      toast({
        tone: 'success',
        title: saved === 1 ? 'Setting saved' : `${String(saved)} settings saved`,
      });
      onSaved?.();
    }
    if (Object.keys(failed).length > 0) {
      toast({
        tone: 'danger',
        title: 'Some settings were not saved',
        description: Object.values(failed)[0],
      });
    }
    // A field that saved now reads from the server; one that failed keeps what was typed.
    setEdits((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key in failed)),
    );
    setReplacing(new Set(Object.keys(failed)));
    setVersion((count) => count + 1);
  }

  async function test(): Promise<void> {
    if (testKey === undefined) return;
    const definition = definitions.find((candidate) => candidate.key === testKey);
    const raw = draft[testKey];
    setTesting(true);
    setResult(null);
    try {
      // An unchanged or locked field is tested with what is in effect: the server fills it in.
      const value =
        definition !== undefined && raw !== undefined && String(raw).trim() !== ''
          ? typed(definition, raw)
          : '';
      setResult(await client.testSetting(testKey, value));
    } catch (error) {
      setResult({ ok: false, message: explain(error, 'The test could not run.') });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form
      aria-label={title}
      className="grid gap-5"
      onSubmit={(event) => void save(event)}
      noValidate
    >
      {canEdit ? null : (
        <p
          className="rounded-md border border-border bg-surface-muted p-3 text-sm text-fg"
          role="note"
        >
          These settings apply to the whole installation, so only an installation admin can change
          them.
        </p>
      )}
      {definitions.map((definition) => (
        <div key={definition.key} className="grid gap-1">
          <Field
            definition={definition}
            read={byKey.get(definition.key)}
            value={draft[definition.key] ?? ''}
            disabled={!canEdit}
            replacing={replacing.has(definition.key)}
            onReplace={() => setReplacing((current) => new Set(current).add(definition.key))}
            onChange={(value) => {
              setResult(null);
              setEdits((current) => ({ ...current, [definition.key]: value }));
            }}
          />
          {errors[definition.key] === undefined ? null : (
            <p className="text-sm text-danger" role="alert" data-testid={`error-${definition.key}`}>
              {errors[definition.key]}
            </p>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button type="submit" disabled={dirty.length === 0} loading={saving} className="min-h-10">
            {dirty.length === 0
              ? 'No changes'
              : (submitLabel ??
                (dirty.length === 1 ? 'Save change' : `Save ${String(dirty.length)} changes`))}
          </Button>
        ) : null}
        {testKey === undefined || !canEdit ? null : (
          <Button
            type="button"
            variant="outline"
            loading={testing}
            onClick={() => void test()}
            className="min-h-10"
          >
            Test connection
          </Button>
        )}
        <p role="status" aria-live="polite" className="text-sm" data-testid="setting-test-result">
          {result === null ? null : (
            <span className={result.ok ? 'text-success' : 'text-danger'}>{result.message}</span>
          )}
        </p>
      </div>
    </form>
  );
}

/** Whether an error means the field is pinned by the environment. Exported for the wizard. */
export function isEnvLocked(error: unknown): boolean {
  return error instanceof SettingsApiError && error.code === 'ENV_LOCKED';
}
