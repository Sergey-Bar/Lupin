/**
 * Usability as tasks a QA person does, timed and counted (plan 1795712849115 task 18).
 *
 * Each test is one question someone opens Lupin to answer. It starts where that person
 * starts (Home, or the screen they are already on), does only what a person would do
 * (click, type, press), and stops when the answer is on the screen. Two budgets are held:
 * how many actions it took, and how long. The action count is the design claim: it does not
 * depend on the machine. The time budget is set for the CI runner, which is about twice as
 * slow as a developer's machine, so it catches a screen that became slow rather than measuring one.
 *
 * Each run writes what it observed to `test-results/evidence/usability/`, so a budget that
 * starts to pinch shows up as a number in the evidence before it shows up as a red test.
 */
import { expect, test, type Page } from '@playwright/test';
import { claimJob, completeJob, createRun, registerRunner, uniqueRunId } from '../support/api.js';
import { saveEvidence } from '../support/evidence.js';
import { authenticate, signInAndVisit } from '../support/session.js';

/** One task: what it asks, how many actions it may take, and how long. */
interface Budget {
  actions: number;
  ms: number;
}

/** Counts what the person does, so a task that grows a step fails by name. */
class Person {
  actions = 0;
  readonly startedAt = Date.now();
  constructor(readonly page: Page) {}

  async click(target: ReturnType<Page['locator']>): Promise<void> {
    this.actions += 1;
    await target.click();
  }

  elapsed(): number {
    return Date.now() - this.startedAt;
  }
}

function hold(task: string, person: Person, budget: Budget): void {
  const observed = { actions: person.actions, ms: person.elapsed() };
  saveEvidence('usability', `${task}.json`, { task, budget, observed });
  expect(observed.actions, `${task}: actions`).toBeLessThanOrEqual(budget.actions);
  expect(observed.ms, `${task}: milliseconds`).toBeLessThanOrEqual(budget.ms);
}

/** A failed run whose failing test is this spec's own, so other specs' runs cannot answer for it. */
async function seedFailure(request: Parameters<typeof createRun>[0]) {
  const suffix = uniqueRunId().slice(0, 8);
  const branch = `usability/${suffix}`;
  const failing = `checkout refuses an expired card ${suffix}`;
  const created = await createRun(request, { branch });
  const runner = await registerRunner(request);
  const job = await claimJob(request, runner, ['playwright'], created.id);
  await completeJob(request, runner, job, {
    outcome: 'failed',
    summary: { total: 2, passed: 1, failed: 1 },
    tests: [
      {
        id: `ok-${suffix}`,
        title: 'pays with a saved card',
        file: 'pay.spec.ts',
        status: 'passed',
      },
      {
        id: `bad-${suffix}`,
        title: failing,
        file: 'pay.spec.ts',
        status: 'failed',
        error: { code: 'ASSERTION_FAILED', message: 'expected "declined" to equal "accepted"' },
      },
    ],
  });
  return { runId: created.id, branch, failing };
}

test.describe('the questions a QA person opens Lupin to answer', () => {
  test('can we ship? The verdict is on Home with nothing to click', async ({
    page,
    context,
    request,
  }) => {
    await seedFailure(request);
    await authenticate(context, request);
    const person = new Person(page);
    await signInAndVisit(page, '/');
    const verdict = page
      .getByRole('region', { name: 'Page content' })
      .getByRole('heading', { level: 2, name: /^(Ready|Caution|No-go|Not measured)$/u })
      .first();
    await expect(verdict).toBeVisible();
    hold('can-we-ship', person, { actions: 0, ms: 8_000 });
  });

  test('is quality getting better or worse? Home says so in one line', async ({
    page,
    context,
    request,
  }) => {
    await seedFailure(request);
    await authenticate(context, request);
    const person = new Person(page);
    await signInAndVisit(page, '/');
    const pulse = page.getByRole('region', { name: 'Quality pulse' });
    await expect(pulse).toBeVisible();
    // The answer is one of four words, never a blank or a number left to interpret.
    await expect(pulse).toContainText(/^(Better|Worse|Steady|Unknown): /u);
    await expect(pulse).toContainText('against the');
    hold('better-or-worse', person, { actions: 0, ms: 8_000 });
  });

  test('why did my branch fail? The failing test and its error, three clicks from Home', async ({
    page,
    context,
    request,
  }) => {
    const seeded = await seedFailure(request);
    await authenticate(context, request);
    await signInAndVisit(page, '/');
    const person = new Person(page);
    const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
    await person.click(sidebar.getByRole('button', { name: /^Runs/u }));
    await person.click(sidebar.getByRole('link', { name: 'All runs' }));
    await person.click(page.getByRole('link', { name: new RegExp(`^${seeded.branch}, run`, 'u') }));
    const failed = page.getByRole('region', { name: 'What failed' });
    await expect(failed).toContainText(seeded.failing);
    await expect(failed).toContainText('expected "declined" to equal "accepted"');
    hold('why-did-it-fail', person, { actions: 3, ms: 15_000 });
  });

  test('this test is broken, not the product: quarantined in two clicks from the failure', async ({
    page,
    context,
    request,
  }) => {
    const seeded = await seedFailure(request);
    await authenticate(context, request);
    await signInAndVisit(page, `/dashboard/runs/${seeded.runId}`);
    const failed = page.getByRole('region', { name: 'What failed' });
    await expect(failed).toContainText(seeded.failing);
    const person = new Person(page);
    await person.click(failed.getByRole('link', { name: 'Quarantine this test' }));
    const dialog = page.getByRole('dialog');
    // The form arrives filled from the failure, so the person types nothing.
    await expect(dialog.getByRole('textbox', { name: 'Test title' })).toHaveValue(seeded.failing);
    await expect(dialog.getByRole('textbox', { name: 'Test file' })).toHaveValue('pay.spec.ts');
    await person.click(dialog.getByRole('button', { name: 'Quarantine' }));
    await expect(page.getByRole('main')).toContainText(seeded.failing);
    hold('quarantine-from-failure', person, { actions: 2, ms: 15_000 });
  });
});
