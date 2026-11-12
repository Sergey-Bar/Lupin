import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetViewerRoleCache } from '../../hooks/useViewerRole.js';
import { QuarantinePage } from './quarantine.js';
import type { ApiClient, QuarantineEntry } from '../../lib/api.js';

/**
 * The quarantine page, which shipped at 6.89% line coverage — a route a reader
 * reaches from the sidebar with no test behind it.
 *
 * The behaviour that needed one most was a *failure*. A rejected add was caught
 * with `console.error` and nothing else, so a reader who submitted a test that
 * was already quarantined saw the form sit there with their text still in it and
 * no sign that anything had happened. Submitting again is the obvious next move
 * and it fails identically.
 */
const entry: QuarantineEntry = {
  id: 'q-1',
  testTitle: 'checkout accepts a negative total',
  testFile: 'tests/checkout.spec.ts',
  reason: 'flaky on CI',
  quarantinedAt: '2026-09-29T00:00:00.000Z',
  status: 'pending',
};

/** An API stub whose quarantine calls are individually controllable. */
function stubApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getQuarantine: vi.fn().mockResolvedValue([entry]),
    addQuarantine: vi.fn().mockResolvedValue({ ...entry, id: 'q-2' }),
    ...overrides,
  } as unknown as ApiClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuarantinePage', () => {
  it('lists a quarantined test with its status, which is the point of the list', async () => {
    render(<QuarantinePage api={stubApi()} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());
    expect(screen.getByText(entry.testTitle)).toBeInTheDocument();
    expect(screen.getByText(entry.testFile)).toBeInTheDocument();
    expect(screen.getByTestId('quarantine-status-q-1')).toHaveTextContent('pending');
  });

  it('ignores a submit with nothing filled in, and does not clear the form', async () => {
    // The guard at the top of `addAsync`. Submitting an empty form must not send a
    // request and must not wipe what the reader has already typed — losing work is
    // the reason this page keeps its field values on a failure.
    const addQuarantine = vi.fn();
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-page')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    await waitFor(() => expect(screen.getByTestId('quarantine-form')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a test' } });
    // `fireEvent.submit` on the form rather than a click on the button: the guard is
    // inside the submit handler, and clicking a `type="submit"` button only reaches
    // it through jsdom's implicit submission, which is one more indirection between
    // the test and the branch it is meant to exercise.
    fireEvent.submit(screen.getByTestId('quarantine-form'));

    expect(addQuarantine).not.toHaveBeenCalled();
    expect(screen.getByTestId('input-test-title')).toHaveValue('a test');
  });

  it('opens the form filled in with a failing test sent from run detail', async () => {
    render(
      <QuarantinePage api={stubApi()} prefill={{ title: 'pays twice', file: 'pay.spec.ts' }} />,
    );
    expect(await screen.findByLabelText('Test title')).toHaveValue('pays twice');
    expect(screen.getByLabelText('Test file')).toHaveValue('pay.spec.ts');
  });

  it('says so when there is nothing in quarantine', async () => {
    render(<QuarantinePage api={stubApi({ getQuarantine: vi.fn().mockResolvedValue([]) })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-empty')).toBeInTheDocument());
  });

  // The copy was title case, "Submit", three dots, and an empty line that repeated its title
  // (ledger MNT-190).
  it('speaks in sentences, and names its action', async () => {
    const { unmount } = render(
      <QuarantinePage
        api={stubApi({ getQuarantine: vi.fn(() => new Promise<QuarantineEntry[]>(() => {})) })}
      />,
    );
    expect(screen.getByText('Reading the quarantine list…')).toBeInTheDocument();
    unmount();
    const failed = render(
      <QuarantinePage
        api={stubApi({ getQuarantine: vi.fn().mockRejectedValue(new Error('x')) })}
      />,
    );
    expect(
      await screen.findByRole('heading', { name: 'The quarantine list could not be read' }),
    ).toBeInTheDocument();
    failed.unmount();
    render(<QuarantinePage api={stubApi({ getQuarantine: vi.fn().mockResolvedValue([]) })} />);
    const empty = await screen.findByTestId('quarantine-empty');
    expect(empty).not.toHaveTextContent(/currently no tests/iu);
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    expect(await screen.findByLabelText('Test title')).toBeInTheDocument();
    expect(screen.getByLabelText('Test file')).toBeInTheDocument();
    expect(screen.getByTestId('submit-quarantine-btn')).toHaveTextContent('Quarantine');
  });

  /**
   * The route renders `<QuarantinePage />` with no props, so the default is the
   * production call shape and every other case here passes a stub.
   *
   * That made the default parameter an untested branch on the only path a user
   * actually takes, and `useQuarantine(undefined)` is what resolves it — a real
   * client against a real `fetch`. Asserted on the outcome the reader sees rather
   * than on the network: a failed request must render the error state, because a
   * page that renders neither the list nor the error has told the reader nothing.
   */
  it('renders the error state when it has to build its own client and the API is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    render(<QuarantinePage />);
    await waitFor(() => expect(screen.getByTestId('quarantine-error')).toBeInTheDocument());
    expect(screen.getByTestId('quarantine-error')).toHaveTextContent('network down');
  });

  it('reports a failed load rather than rendering an empty list', async () => {
    // An empty list and a failed load look identical on screen unless one of them
    // says so, and "no tests are quarantined" is a very different claim from "I
    // could not ask".
    render(
      <QuarantinePage
        api={stubApi({
          getQuarantine: vi.fn().mockRejectedValue(new Error('quarantine unavailable')),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-error')).toBeInTheDocument());
    expect(screen.getByTestId('quarantine-error')).toHaveTextContent('quarantine unavailable');
    expect(screen.queryByTestId('quarantine-empty')).not.toBeInTheDocument();
  });

  it('shows a rejected add to the reader and keeps their text', async () => {
    const addQuarantine = vi.fn().mockRejectedValue(new Error('already quarantined'));
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a new test' } });
    fireEvent.change(screen.getByTestId('input-test-file'), {
      target: { value: 'tests/new.spec.ts' },
    });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    // The failure is on screen, in the form, with the reader's work intact.
    await waitFor(() => expect(screen.getByTestId('quarantine-add-error')).toBeInTheDocument());
    expect(screen.getByTestId('quarantine-add-error')).toHaveTextContent('already quarantined');
    expect((screen.getByTestId('input-test-title') as HTMLInputElement).value).toBe('a new test');
  });

  it('shows the new entry at once, marked unsaved, and closes the form before the server answers', async () => {
    let answer: (value: QuarantineEntry) => void = () => undefined;
    const addQuarantine = vi.fn(
      () => new Promise<QuarantineEntry>((resolve) => (answer = resolve)),
    );
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a new test' } });
    fireEvent.change(screen.getByTestId('input-test-file'), {
      target: { value: 'tests/new.spec.ts' },
    });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    await waitFor(() => expect(screen.getByText('a new test')).toBeInTheDocument());
    expect(screen.queryByTestId('quarantine-form')).not.toBeInTheDocument();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    answer({ ...entry, id: 'q-2', testTitle: 'a new test', testFile: 'tests/new.spec.ts' });
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-2')).toBeInTheDocument());
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('takes a refused entry back out of the list', async () => {
    const addQuarantine = vi.fn().mockRejectedValue(new Error('already quarantined'));
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'refused' } });
    fireEvent.change(screen.getByTestId('input-test-file'), { target: { value: 'r.spec.ts' } });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));
    await waitFor(() => expect(screen.getByTestId('quarantine-add-error')).toBeInTheDocument());
    expect(screen.queryByTestId(/^quarantine-item-unsaved/)).not.toBeInTheDocument();
  });

  it('does not log the failure and hide it', async () => {
    // The defect was `console.error(err)` and nothing else, so the only trace was
    // in a console nobody reads. Asserted explicitly: a regression back to a bare
    // console call would leave the rendered error present *and* reintroduce the
    // leak, and this is what says no.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <QuarantinePage
        api={stubApi({ addQuarantine: vi.fn().mockRejectedValue(new Error('nope')) })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('input-test-file'), { target: { value: 'y.spec.ts' } });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));
    await waitFor(() => expect(screen.getByTestId('quarantine-add-error')).toBeInTheDocument());
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('clears a previous error when the form is reopened', async () => {
    const addQuarantine = vi.fn().mockRejectedValue(new Error('nope'));
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('input-test-file'), { target: { value: 'y.spec.ts' } });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));
    await waitFor(() => expect(screen.getByTestId('quarantine-add-error')).toBeInTheDocument());

    // Reopening is a new attempt; the old message must not describe it.
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    expect(screen.queryByTestId('quarantine-add-error')).not.toBeInTheDocument();
  });

  it('adds a test and closes the form on success', async () => {
    const addQuarantine = vi.fn().mockResolvedValue({ ...entry, id: 'q-2' });
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a new test' } });
    fireEvent.change(screen.getByTestId('input-test-file'), {
      target: { value: 'tests/new.spec.ts' },
    });
    fireEvent.change(screen.getByTestId('input-reason'), { target: { value: 'flaky' } });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    await waitFor(() => expect(screen.queryByTestId('quarantine-form')).not.toBeInTheDocument());
    expect(addQuarantine).toHaveBeenCalledWith({
      testTitle: 'a new test',
      testFile: 'tests/new.spec.ts',
      reason: 'flaky',
    });
  });

  it('omits an empty reason rather than sending a blank one', async () => {
    const addQuarantine = vi.fn().mockResolvedValue({ ...entry, id: 'q-2' });
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a new test' } });
    fireEvent.change(screen.getByTestId('input-test-file'), {
      target: { value: 'tests/new.spec.ts' },
    });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    await waitFor(() => expect(addQuarantine).toHaveBeenCalled());
    expect(addQuarantine).toHaveBeenCalledWith({
      testTitle: 'a new test',
      testFile: 'tests/new.spec.ts',
      reason: undefined,
    });
  });

  it('renders an approved entry differently from a pending one', async () => {
    // The comment in the component says why: showing the file without the status
    // leads a reader to conclude every entry is already excluded from the pass
    // rate, which is false until somebody acts on it.
    render(
      <QuarantinePage
        api={stubApi({
          getQuarantine: vi.fn().mockResolvedValue([{ ...entry, status: 'approved' }]),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-status-q-1')).toBeInTheDocument());
    expect(screen.getByTestId('quarantine-status-q-1')).toHaveTextContent('approved');
  });

  /**
   * The colour each verdict is painted in, asserted against the class rather than
   * the rendered colour, because jsdom has no stylesheet.
   *
   * **These three cases exist because the mapping was inverted.** `approved` rendered
   * in `text-error` and `rejected` in `text-success`, so on the screen whose whole
   * job is to say which is which an approval read as a failure and a rejection as a
   * pass — and a reader scanning for red found the one entry that had been approved.
   */
  it.each([
    ['approved', 'bg-success'],
    ['rejected', 'bg-danger'],
    ['pending', 'bg-warning'],
  ] as const)('paints %s in the %s tone', async (status, tone) => {
    render(
      <QuarantinePage
        api={stubApi({
          getQuarantine: vi.fn().mockResolvedValue([{ ...entry, status }]),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-status-q-1')).toBeInTheDocument());
    const element = screen.getByTestId('quarantine-status-q-1');
    expect(element).toHaveClass(tone);
    // The other two tones, by name. `Badge` paints a verdict as a filled pill, so asserting
    // one tone is not enough: a badge carrying both `bg-success` and `bg-danger` would pass
    // the check above and tell the reader two things at once.
    for (const other of ['bg-success', 'bg-danger', 'bg-warning'].filter(
      (candidate) => candidate !== tone,
    )) {
      expect(element.className, 'a verdict carries exactly one tone').not.toContain(other);
    }
  });

  /**
   * The word and the tone are the same element.
   *
   * **This is the property DESIGN-1 was about, and nothing here asserted it.** The screen
   * once rendered the status as text in one element and coloured a different one, so a verdict
   * could read "approved" in amber. Both are now one `Badge`, and this is the case that fails
   * if someone splits them again.
   */
  it('puts the verdict and its colour in one element', async () => {
    render(
      <QuarantinePage
        api={stubApi({
          getQuarantine: vi.fn().mockResolvedValue([{ ...entry, status: 'approved' }]),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-status-q-1')).toBeInTheDocument());
    const element = screen.getByTestId('quarantine-status-q-1');
    expect(element.textContent?.trim()).toBe('approved');
    expect(element).toHaveClass('bg-success');
  });

  it('does not paint a verdict it does not recognise', async () => {
    // A status the API has since added must not inherit `pending`'s amber. The
    // table is typed `Partial<Record<QuarantineEntry['status'], string>>` for exactly
    // this, and the fallback is the neutral muted colour rather than a colour that
    // means "someone still has to look at this".
    const unknown = { ...entry, status: 'appealed' } as unknown as QuarantineEntry;
    render(
      <QuarantinePage api={stubApi({ getQuarantine: vi.fn().mockResolvedValue([unknown]) })} />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-status-q-1')).toBeInTheDocument());
    const status = screen.getByTestId('quarantine-status-q-1');
    // The neutral badge, not `pending`'s amber. `Badge`'s default variant is
    // `border-transparent bg-accent`, so the assertion is on the absence of the three
    // verdict tones rather than on a muted text class the badge does not use.
    for (const tone of ['bg-success', 'bg-danger', 'bg-warning']) {
      expect(status.className, 'an unrecognised verdict inherits no tone').not.toContain(tone);
    }
    expect(status.textContent?.trim()).toBe('appealed');
  });
});

describe('deciding a quarantine entry from the list (plan Wave 1 task 1)', () => {
  it('sends the decision with its reason and shows the status the API answered', async () => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.open = false;
    };
    resetViewerRoleCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ actor: 'you', role: 'operator', mode: 'enforced' })),
      ),
    );
    const resolveQuarantine = vi.fn().mockResolvedValue({ ...entry, status: 'approved' });
    const user = userEvent.setup();
    render(<QuarantinePage api={stubApi({ resolveQuarantine })} />);
    const row = within(await screen.findByTestId('quarantine-item-q-1'));
    await waitFor(() => expect(row.getByRole('button', { name: 'Approve' })).toBeEnabled());
    await user.click(row.getByRole('button', { name: 'Approve' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Reason (required)'), 'flaky, ticket QA-12');
    await user.click(dialog.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.getByTestId('quarantine-status-q-1')).toHaveTextContent('approved'),
    );
    expect(resolveQuarantine).toHaveBeenCalledWith('q-1', {
      status: 'approved',
      resolution: 'flaky, ticket QA-12',
    });
    vi.unstubAllGlobals();
  });
});
