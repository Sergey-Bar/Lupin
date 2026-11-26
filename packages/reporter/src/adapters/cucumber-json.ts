import type { ProducerAdapter } from '../adapter.js';
import { list, record, type Json } from './json-fields.js';
import {
  durationOf,
  parseJsonDocument,
  relativePath,
  statusOf,
  testResultsRun,
  textOf,
  type StepInput,
  type TestInput,
} from './test-results-json.js';

/**
 * Cucumber JSON (`--format json`, written the same way by Cucumber-JVM, cucumber-js, Behave's
 * JSON formatter and SpecFlow's) (plan 1795712849115 task 11).
 *
 * An array of features, each with `elements`: scenarios, and the backgrounds that run before
 * them. A scenario's verdict is its worst step, background included, because a background that
 * failed means the scenario's own steps never ran. Steps keep their keyword and status as the
 * scenario's steps. Durations are nanoseconds.
 *
 * A Scenario Outline writes one element per example row with the same name, so a name repeated
 * within a feature is told apart by its line. Without that, the rows of one outline would be
 * read as attempts of one test, and a row that failed beside one that passed as a flaky test.
 */

const LABEL = 'Cucumber JSON report';

/** Worst first: the order a scenario's verdict is chosen in. */
const SEVERITY = ['failed', 'ambiguous', 'undefined', 'pending', 'skipped', 'passed'];

/**
 * A scenario's raw status: its worst known step status. A step status Cucumber does not
 * define makes the scenario that word, which the status table reads as `unknown`, unless a
 * step failed outright; so an unreadable step can never turn a scenario into a pass.
 */
export function worstStatus(statuses: readonly string[]): string {
  const known = statuses.filter((status) => SEVERITY.includes(status));
  const strange = statuses.find((status) => !SEVERITY.includes(status));
  if (known.includes('failed') || strange === undefined) {
    return known.sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b))[0] ?? '';
  }
  return strange;
}

function stepsOf(element: Json): Array<{ step: StepInput; nanos: number | undefined }> {
  return list(element['steps']).flatMap((item) => {
    const step = record(item);
    if (step === null) return [];
    const result = record(step['result']);
    const name = `${textOf(step['keyword'])} ${textOf(step['name'])}`.trim();
    return [
      {
        step: {
          name: name === '' ? 'step' : name,
          rawStatus: textOf(result?.['status']),
          ...(textOf(result?.['error_message']) === ''
            ? {}
            : { message: textOf(result?.['error_message']) }),
        },
        nanos: durationOf(result?.['duration']),
      },
    ];
  });
}

function scenarioOf(
  feature: Json,
  element: Json,
  background: ReturnType<typeof stepsOf>,
  repeated: boolean,
): TestInput | null {
  const name = textOf(element['name']);
  if (name === '') return null;
  const steps = [...background, ...stepsOf(element)];
  const worst = worstStatus(steps.map(({ step }) => step.rawStatus));
  const nanos = steps.reduce((total, { nanos: n }) => total + (n ?? 0), 0);
  const line = typeof element['line'] === 'number' ? element['line'] : undefined;
  const failure = steps.find(({ step }) => step.message !== undefined)?.step.message;
  return {
    file: relativePath(textOf(feature['uri'])),
    describePath: [textOf(feature['name'])].filter((segment) => segment !== ''),
    title: repeated && line !== undefined ? `${name} (line ${String(line)})` : name,
    attempts: [
      {
        rawStatus: worst,
        status: steps.length === 0 ? 'unknown' : statusOf('cucumber', worst),
        durationMs: nanos / 1e6,
        ...(failure === undefined ? {} : { message: failure }),
        steps: steps.map(({ step }) => step),
      },
    ],
  };
}

function scenariosOf(feature: Json): TestInput[] {
  const elements = list(feature['elements'])
    .map(record)
    .filter((element): element is Json => element !== null);
  const names = elements
    .filter((element) => textOf(element['type']) !== 'background')
    .map((element) => textOf(element['name']));
  let background: ReturnType<typeof stepsOf> = [];
  return elements.flatMap((element) => {
    if (textOf(element['type']) === 'background') {
      background = stepsOf(element);
      return [];
    }
    const name = textOf(element['name']);
    const repeated = names.indexOf(name) !== names.lastIndexOf(name);
    const scenario = scenarioOf(feature, element, background, repeated);
    background = [];
    return scenario === null ? [] : [scenario];
  });
}

export const cucumberJsonAdapter: ProducerAdapter = {
  mediaType: 'application/vnd.cucumber+json',
  parse(input, context) {
    const document = parseJsonDocument(input, LABEL);
    if (!Array.isArray(document)) throw new Error(`${LABEL} is not an array of features`);
    const tests = document
      .map(record)
      .flatMap((feature) => (feature === null ? [] : scenariosOf(feature)));
    return testResultsRun(tests, 'cucumber', 'packages/reporter cucumber-json', context);
  },
};
