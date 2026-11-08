import React from 'react';
import { Button, CircleAlert, CircleCheck } from '@lupin/ui';
import type { HealthClient } from '../lib/health-client.js';
import { canAdminister, canAdministerInstallation } from '../lib/roles.js';
import { explain, type IdentityDraftStatus, type SettingsClient } from '../lib/settings-client.js';
import { AccessGate } from './Access.js';
import { PageBody, PageFrame, PageHeader, Panel } from './kit.js';
import { SettingsForm } from './SettingsForm.js';
import { useToast } from './Toasts.js';

/**
 * Settings → Identity: change sign-in without locking anyone out.
 *
 * Three steps, shown as three steps, because skipping one is how an install loses its admin:
 *
 *  1. **Edit** the provider and the role rules, and save them as a draft.
 *  2. **Test sign-in**: the browser goes to the provider with the draft configuration and
 *     comes back here. Nobody is signed in by it; the draft records who came back and the
 *     role the draft's rules give them.
 *  3. **Apply**, only when that person is an admin. The API refuses anything else.
 *
 * The draft id is kept in session storage across the round trip to the provider.
 */
const DRAFT_KEY = 'lupin-identity-draft';

function storedDraft(): string | null {
  try {
    return sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function storeDraft(id: string | null): void {
  try {
    if (id === null) sessionStorage.removeItem(DRAFT_KEY);
    else sessionStorage.setItem(DRAFT_KEY, id);
  } catch {
    // Without storage the draft is lost on the round trip; the page then asks to test again.
  }
}

const RETURN_MESSAGES: Record<string, string> = {
  failed:
    'The provider did not complete the sign-in. Check the client id and secret, and that this address is registered as a redirect URI.',
  unreachable:
    'The provider could not be reached at that issuer address. Check it, then test again.',
  expired: 'The draft expired. Save your changes again and test within ten minutes.',
};

function Verdict({ status }: { status: IdentityDraftStatus }): React.ReactElement | null {
  const verified = status.verified;
  if (verified === null) return null;
  const admin = verified.role === 'admin';
  const Icon = admin ? CircleCheck : CircleAlert;
  return (
    <p className="flex items-start gap-2 text-sm" role="status" data-testid="identity-verdict">
      <Icon
        aria-hidden
        className={`mt-0.5 size-4 shrink-0 ${admin ? 'text-success' : 'text-danger'}`}
      />
      <span>
        You signed in as <span className="font-mono">{verified.email}</span>
        {verified.groups.length === 0 ? '' : ` (groups: ${verified.groups.join(', ')})`}, who would
        be <strong>{verified.role ?? 'refused'}</strong>.{' '}
        {admin
          ? 'You keep admin access, so these changes are safe to apply.'
          : 'Applying this would remove your admin access. Add a rule that keeps you an admin, then test again.'}
      </span>
    </p>
  );
}

export function IdentitySettingsPage({
  health,
  client,
  search = typeof window === 'undefined' ? '' : window.location.search,
  go = (url: string) => window.location.assign(url),
}: {
  health: HealthClient;
  client: SettingsClient;
  /** The page's query string, so a return from the provider is seen. Injected by tests. */
  search?: string;
  /** Follows the test sign-in URL. Injected by tests. */
  go?: (url: string) => void;
}): React.ReactElement {
  const toast = useToast();
  const [draftId, setDraftId] = React.useState<string | null>(() => storedDraft());
  const [status, setStatus] = React.useState<IdentityDraftStatus | null>(null);
  const [needsTest, setNeedsTest] = React.useState(true);
  const [testUrl, setTestUrl] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [formVersion, setFormVersion] = React.useState(0);
  const returned = new URLSearchParams(search).get('test');

  React.useEffect(() => {
    if (draftId === null) return;
    let live = true;
    client
      .identityDraftStatus(draftId)
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => {
        if (!live) return;
        storeDraft(null);
        setDraftId(null);
      });
    return () => {
      live = false;
    };
  }, [client, draftId]);

  async function saveDraft(values: Record<string, string | number | boolean>): Promise<void> {
    const draft = await client.identityDraft(values);
    storeDraft(draft.id);
    setDraftId(draft.id);
    setStatus({ id: draft.id, verified: null });
    setNeedsTest(draft.needsTest);
    setTestUrl(draft.testUrl);
  }

  async function apply(): Promise<void> {
    if (draftId === null) return;
    setApplying(true);
    try {
      await client.identityApply(draftId);
      toast({
        tone: 'success',
        title: 'Sign-in settings applied',
        description: 'They take effect at the next sign-in.',
      });
      storeDraft(null);
      setDraftId(null);
      setStatus(null);
      setFormVersion((count) => count + 1);
    } catch (error) {
      toast({
        tone: 'danger',
        title: 'Not applied',
        description: explain(error, 'The request failed.'),
      });
    } finally {
      setApplying(false);
    }
  }

  const verified = status?.verified ?? null;
  const canApply =
    draftId !== null && (verified?.role === 'admin' || (!needsTest && verified === null));

  return (
    <PageFrame data-testid="settings-identity">
      <PageHeader
        title="Identity"
        subtitle="Single sign-on and who gets which role. Changes are tested with a real sign-in before they apply, so nobody is locked out."
      />
      <PageBody>
        <AccessGate health={health}>
          {(who) =>
            !canAdminister(who) ? (
              <p role="note" className="text-sm text-fg-muted">
                Ask an admin to change sign-in settings.
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="1. Edit">
                  <SettingsForm
                    key={formVersion}
                    client={client}
                    group="identity"
                    title="Sign-in settings"
                    canEdit={canAdministerInstallation(who)}
                    submitLabel="Save as draft"
                    onSubmitValues={saveDraft}
                  />
                </Panel>
                <Panel title="2. Test, then 3. Apply">
                  <div className="grid gap-4" aria-live="polite">
                    {returned !== null && returned !== 'done' ? (
                      <p role="alert" className="text-sm text-danger">
                        {RETURN_MESSAGES[returned] ?? RETURN_MESSAGES['failed']}
                      </p>
                    ) : null}
                    {draftId === null ? (
                      <p className="text-sm text-fg-muted" data-testid="identity-no-draft">
                        Change a setting and save it as a draft. Nothing changes for anyone until
                        you apply it.
                      </p>
                    ) : (
                      <>
                        {status === null ? null : <Verdict status={status} />}
                        {needsTest && verified === null ? (
                          <p className="text-sm text-fg">
                            Sign in through your provider with the draft. You will come back here;
                            nobody is signed in or out by the test.
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-3">
                          {needsTest ? (
                            <Button
                              type="button"
                              variant={verified === null ? 'primary' : 'outline'}
                              className="min-h-10"
                              onClick={() =>
                                go(
                                  testUrl ??
                                    `/api/v1/auth/oidc/test?draft=${encodeURIComponent(draftId)}`,
                                )
                              }
                            >
                              {verified === null ? 'Test sign-in' : 'Test again'}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            className="min-h-10"
                            variant={canApply ? 'primary' : 'outline'}
                            disabled={!canApply}
                            loading={applying}
                            onClick={() => void apply()}
                          >
                            Apply changes
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-10"
                            onClick={() => {
                              storeDraft(null);
                              setDraftId(null);
                              setStatus(null);
                            }}
                          >
                            Discard draft
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </Panel>
              </div>
            )
          }
        </AccessGate>
      </PageBody>
    </PageFrame>
  );
}
