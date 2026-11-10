import { useEffect, useRef, useState } from 'react';
import { Button } from '@lupin/ui';
import { isTypingTarget } from './Shortcuts.js';
import {
  createCopilotClient,
  type CopilotAction,
  type CopilotClient,
  type RunExplanation,
} from '../lib/copilot-client.js';
import { defaultApiClient } from '../lib/api.js';

/** The fragment a test row carries, so a citation can point at it. */
export function testAnchor(testId: string): string {
  return `test-${testId}`;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'answer'; answer: RunExplanation }
  | { kind: 'error' };

const defaultClient = createCopilotClient();

/**
 * "Explain this run": the copilot answering in place, from the run's own evidence.
 *
 * The answer is announced through a polite live region, so a screen-reader user hears it
 * arrive without losing their place. Every test it names is a link to that test's row on
 * this page, which is how a reader checks the claim rather than trusting it.
 */
export function CopilotExplain({
  runId,
  client = defaultClient,
  act = performAction,
}: {
  runId: string;
  client?: CopilotClient;
  /** Carries out a confirmed action as the signed-in user; resolves to what happened. */
  act?: (action: CopilotAction) => Promise<string>;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const ask = async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'answer', answer: await client.explainRun(runId) });
    } catch {
      setState({ kind: 'error' });
    }
  };

  // `e` explains, like `a` takes the main action: never from a field, never with a modifier.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() !== 'e') return;
      event.preventDefault();
      void askRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section data-testid="copilot-explain" aria-label="Copilot" className="space-y-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void ask()}
        disabled={state.kind === 'loading'}
        aria-keyshortcuts="e"
      >
        {state.kind === 'loading' ? 'Explaining…' : 'Explain this run'}
      </Button>
      <div role="status" aria-live="polite" className="space-y-3 text-sm">
        {state.kind === 'error' ? (
          <p className="text-fg-muted">The copilot could not explain this run. Try again.</p>
        ) : null}
        {state.kind === 'answer' ? <Answer answer={state.answer} act={act} /> : null}
      </div>
    </section>
  );
}

function Answer({
  answer,
  act,
}: {
  answer: RunExplanation;
  act: (action: CopilotAction) => Promise<string>;
}) {
  return (
    <div data-testid="copilot-answer" className="space-y-3">
      {answer.actions.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {answer.actions.map((action) => (
            <ActionCard key={action.label} action={action} act={act} />
          ))}
        </div>
      )}
      <p className="max-w-measure text-pretty text-fg">{answer.summary}</p>
      {answer.causes.length === 0 ? null : (
        <ul className="space-y-2">
          {answer.causes.map((cause) => (
            <li key={cause.message} className="space-y-1">
              <p className="font-mono text-fg">
                <span className="me-2 font-sans font-semibold text-danger">{cause.count}×</span>
                {cause.message}
              </p>
              <p className="flex flex-wrap gap-x-3 text-xs">
                {cause.tests.map((testId) => (
                  <a
                    key={testId}
                    href={`#${testAnchor(testId)}`}
                    className="inline-flex min-h-6 items-center rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    {testId}
                  </a>
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-muted">
        From the run's own results, without a model. Every test named is linked.
      </p>
    </div>
  );
}

/**
 * A proposed action, and the one confirmation before it runs. The copilot never acts on its
 * own: it calls the same guarded route the page's own button calls, as the signed-in user, so
 * the server's role check and audit trail apply unchanged.
 */
function ActionCard({
  action,
  act,
}: {
  action: CopilotAction;
  act: (action: CopilotAction) => Promise<string>;
}) {
  const [step, setStep] = useState<'offer' | 'confirm' | 'running' | { done: string }>('offer');
  if (step === 'offer') {
    return (
      <Button variant="secondary" size="sm" onClick={() => setStep('confirm')}>
        {action.label}
      </Button>
    );
  }
  if (typeof step === 'object') return <p className="text-fg">{step.done}</p>;
  return (
    <div
      data-testid="copilot-confirm"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border-default p-2"
    >
      <span className="text-fg">{action.label}?</span>
      <Button
        size="sm"
        disabled={step === 'running'}
        onClick={() => {
          setStep('running');
          act(action).then(
            (done) => setStep({ done }),
            () => setStep({ done: 'That did not work. Nothing was changed.' }),
          );
        }}
      >
        Confirm
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setStep('offer')}>
        Cancel
      </Button>
    </div>
  );
}

async function performAction(action: CopilotAction): Promise<string> {
  if (action.kind === 'retry') {
    await defaultApiClient.retryRun(action.runId, undefined, { scope: action.scope });
    return 'Retry started.';
  }
  await defaultApiClient.addQuarantine({
    testTitle: action.testTitle,
    testFile: action.testFile,
    stableId: action.testId,
    reason: `Proposed by the copilot from run ${action.runId}`,
  });
  return 'Quarantine requested. It waits for approval.';
}
