-- A notification channel may now be an email bridge (daily-export upgrade). Additive only.
--
-- `email` joins the kinds a channel may be, so the full HTML report (or the plain digest) can
-- reach an inbox. The channel's settings carry the sender, recipients and subject; the secret
-- is the email bridge's base URL, sealed in the vault like every other channel's credential.
-- The adapter talks HTTP only (`@lupin/connectors-email`), so no SMTP client enters the tree.
--
-- The CHECK is replaced rather than dropped: a channel kind the application cannot render must
-- still be refused by the database, which is what the constraint is for. Replacing it admits
-- the new kind and nothing else. Safe to apply twice — the drop is `IF EXISTS`.

ALTER TABLE "notification_channels" DROP CONSTRAINT IF EXISTS "notification_channels_kind_check";
--> statement-breakpoint
ALTER TABLE "notification_channels"
  ADD CONSTRAINT "notification_channels_kind_check"
  CHECK ("kind" IN ('inbox', 'slack', 'teams', 'telegram', 'whatsapp', 'signal', 'email'));
