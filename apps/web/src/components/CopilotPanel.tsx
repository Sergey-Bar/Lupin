import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button, X } from '@lupin/ui';
import { createCopilotClient, type QuestionAnswer } from '../lib/copilot-client.js';

/**
 * The copilot's side panel: the thread of what was asked and answered, kept while the reader
 * moves between pages, so a follow-up does not start from nothing. It opens from the command
 * palette's "Ask Lupin" entry. Answers come from the rule engine and cite what they read;
 * every link it offers stays inside the app (the client refuses any other).
 */
export interface ThreadEntry {
  id: number;
  question: string;
  answer: QuestionAnswer | 'loading' | 'error';
}

interface CopilotContextValue {
  ask: (question: string) => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function useCopilot(): CopilotContextValue | null {
  return useContext(CopilotContext);
}

const defaultAsk = (question: string) => createCopilotClient().ask(question);

export function CopilotProvider({
  children,
  askImpl = defaultAsk,
}: {
  children: ReactNode;
  askImpl?: (question: string) => Promise<QuestionAnswer>;
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const next = useRef(0);
  const ask = useCallback(
    (question: string) => {
      const id = next.current++;
      setOpen(true);
      setThread((entries) => [...entries, { id, question, answer: 'loading' }]);
      const settle = (answer: ThreadEntry['answer']) =>
        setThread((entries) =>
          entries.map((entry) => (entry.id === id ? { ...entry, answer } : entry)),
        );
      askImpl(question).then(settle, () => settle('error'));
    },
    [askImpl],
  );
  const value = useMemo(() => ({ ask }), [ask]);
  const close = useCallback(() => setOpen(false), []);
  return (
    <CopilotContext.Provider value={value}>
      {children}
      {open ? <CopilotPanel thread={thread} onAsk={ask} onClose={close} /> : null}
    </CopilotContext.Provider>
  );
}

function CopilotPanel({
  thread,
  onAsk,
  onClose,
}: {
  thread: ThreadEntry[];
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  // Escape closes the panel from anywhere, like the palette; the listener lives while it is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside
      data-testid="copilot-panel"
      aria-label="Copilot"
      className="fixed inset-y-0 end-0 z-modal flex w-full max-w-md flex-col border-s border-border-default surface-translucent shadow-elevation-3 animate-fade-in"
    >
      <header className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Ask Lupin</h2>
        <Button variant="ghost" size="sm" aria-label="Close the copilot" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      <ol
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm"
      >
        {thread.map((entry) => (
          <li key={entry.id} className="space-y-2">
            <p className="font-medium text-fg">{entry.question}</p>
            {entry.answer === 'loading' ? (
              <p className="text-fg-muted">Reading the runs…</p>
            ) : entry.answer === 'error' ? (
              <p className="text-fg-muted">The copilot could not answer. Try again.</p>
            ) : (
              <div className="space-y-2">
                <p className="max-w-measure text-pretty text-fg">{entry.answer.answer}</p>
                {entry.answer.links.length === 0 ? null : (
                  <p className="flex flex-wrap gap-x-4">
                    {entry.answer.links.map((link) => (
                      <a
                        key={link.to}
                        href={link.to}
                        className="inline-flex min-h-6 items-center rounded-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                      >
                        {link.label}
                      </a>
                    ))}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <form
        className="flex gap-2 border-t border-border-default p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const question = draft.trim();
          if (question === '') return;
          setDraft('');
          onAsk(question);
        }}
      >
        <label className="sr-only" htmlFor="copilot-question">
          Ask a follow-up
        </label>
        <input
          id="copilot-question"
          value={draft}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a follow-up…"
          className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-transparent px-3 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        />
        <Button type="submit">Ask</Button>
      </form>
    </aside>
  );
}
