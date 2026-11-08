import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { InferSelectModel } from 'drizzle-orm';
import { workspaces } from './dashboard.js';

// ─── Settings and onboarding ────────────────────────────────────────────────
//
// Added in `0057_settings_onboarding.sql`.
//
// `installation_settings` holds the values an installation admin saved from the interface for
// the keys `SETTINGS` in `@lupin/shared-contracts` declares. It is global: an AI gateway or a
// sign-in provider belongs to the installation, not to a tenant. **No secret is stored here.**
// A secret setting is a `vault_entries` row under connector name `setting:<key>` in the
// installation's home workspace, and `value` holds only `{ "sealed": true, "last4": "…" }`.
//
// `onboarding_progress` is per workspace: which setup steps a tenant chose to skip, and
// whether they dismissed the checklist. Hard-scoped from its first migration.

export const installationSettings = pgTable('installation_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const onboardingProgress = pgTable(
  'onboarding_progress',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    /** A step id from `ONBOARDING_STEPS`, or `checklist` for the dismissal of the whole card. */
    step: text('step').notNull(),
    state: text('state').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.step] }),
    index('onboarding_progress_workspace_idx').on(table.workspaceId),
  ],
);

export type InstallationSetting = InferSelectModel<typeof installationSettings>;
export type OnboardingProgressRow = InferSelectModel<typeof onboardingProgress>;
