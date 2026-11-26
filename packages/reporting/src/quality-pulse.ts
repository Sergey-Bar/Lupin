import type {
  PulseDirection,
  PulseVital,
  PulseVitalId,
  QualityPulse,
} from '@lupin/shared-contracts';

/**
 * The quality pulse: did this project's quality get better or worse, and why (plan
 * 1795712849115 task 14). Pure; the caller gathers both windows.
 *
 * **One regression is news.** The direction is `worse` when any sign got worse past its noise
 * floor, whatever else improved, because a QA person reading "better" must not find a new
 * failure under it. The signs that moved the other way are listed in `alsoMoved`. It is
 * `better` when something improved and nothing got worse, `steady` when signs were measured
 * and none moved past noise, and `unknown` when no sign could be compared at all.
 *
 * **The cause is the sign that moved furthest**, measured in multiples of its own noise floor,
 * so a 6-point coverage fall outranks a 0.6-point pass-rate dip, and the gate turning red
 * outranks both. Ties go to the order of `VITALS`, which is their importance.
 *
 * **AI-era signs** compare AI-written change with itself over time: its change failure rate,
 * its revert rate and the coverage of the lines it changed. A sign with too few changes behind
 * it is `null` upstream and `unknown` here.
 */

export interface PulseReading {
  current: number | null;
  previous: number | null;
}

export interface PulseInput {
  projectId: string;
  evaluatedAt: string;
  windowDays: number;
  /** Runs with a verdict in each window, which is what confidence is read from. */
  runs: { current: number; previous: number };
  /** 1 for a passed gate, 0 for a failed one, `null` for none. */
  gate: PulseReading;
  passRate: PulseReading;
  failingTests: PulseReading;
  flakyRate: PulseReading;
  coverage: PulseReading;
  aiChangeFailureRate: PulseReading;
  aiRevertRate: PulseReading;
  aiDiffCoverage: PulseReading;
}

interface VitalSpec {
  id: PulseVitalId;
  read: (input: PulseInput) => PulseReading;
  label: string;
  unit: PulseVital['unit'];
  higherIsBetter: boolean;
  /** A move smaller than this is noise. */
  noise: number;
  ai: boolean;
  /** How the move reads: "{label} {verb} {amount}". */
  up: string;
  down: string;
}

const VITALS: readonly VitalSpec[] = [
  {
    id: 'gate',
    read: (i) => i.gate,
    label: 'The quality gate',
    unit: 'status',
    higherIsBetter: true,
    noise: 0.5,
    ai: false,
    up: 'passes again',
    down: 'started failing',
  },
  {
    id: 'failing-tests',
    read: (i) => i.failingTests,
    label: 'Failing tests',
    unit: 'count',
    higherIsBetter: false,
    noise: 1,
    ai: false,
    up: 'rose',
    down: 'fell',
  },
  {
    id: 'pass-rate',
    read: (i) => i.passRate,
    label: 'Pass rate',
    unit: 'percent',
    higherIsBetter: true,
    noise: 0.5,
    ai: false,
    up: 'rose',
    down: 'fell',
  },
  {
    id: 'ai-change-failure-rate',
    read: (i) => i.aiChangeFailureRate,
    label: 'AI-written changes causing failures',
    unit: 'percent',
    higherIsBetter: false,
    noise: 2,
    ai: true,
    up: 'rose',
    down: 'fell',
  },
  {
    id: 'ai-revert-rate',
    read: (i) => i.aiRevertRate,
    label: 'AI-written changes reverted',
    unit: 'percent',
    higherIsBetter: false,
    noise: 2,
    ai: true,
    up: 'rose',
    down: 'fell',
  },
  {
    id: 'coverage',
    read: (i) => i.coverage,
    label: 'Coverage',
    unit: 'percent',
    higherIsBetter: true,
    noise: 0.5,
    ai: false,
    up: 'rose',
    down: 'fell',
  },
  {
    id: 'ai-diff-coverage',
    read: (i) => i.aiDiffCoverage,
    label: 'Coverage of AI-written lines',
    unit: 'percent',
    higherIsBetter: true,
    noise: 2,
    ai: true,
    up: 'rose',
    down: 'fell',
  },
  {
    id: 'flaky-rate',
    read: (i) => i.flakyRate,
    label: 'Flaky tests',
    unit: 'percent',
    higherIsBetter: false,
    noise: 0.5,
    ai: false,
    up: 'rose',
    down: 'fell',
  },
];

const round1 = (value: number): number => Math.round(value * 10) / 10;
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

function directionOf(spec: VitalSpec, delta: number | null): PulseDirection {
  if (delta === null) return 'unknown';
  if (Math.abs(delta) < spec.noise) return 'steady';
  return delta > 0 === spec.higherIsBetter ? 'better' : 'worse';
}

function amount(spec: VitalSpec, delta: number): string {
  const size = Math.abs(delta);
  if (spec.unit === 'percent') return ` ${size.toFixed(1)} pts`;
  if (spec.unit === 'count') return ` by ${String(Math.round(size))}`;
  return '';
}

function phrase(spec: VitalSpec, delta: number): string {
  return `${spec.label} ${delta > 0 ? spec.up : spec.down}${amount(spec, delta)}`;
}

interface Scored {
  spec: VitalSpec;
  vital: PulseVital;
  weight: number;
  order: number;
}

function confidenceOf(input: PulseInput, compared: number): QualityPulse['confidence'] {
  const fewest = Math.min(input.runs.current, input.runs.previous);
  if (compared >= 3 && fewest >= 5) return 'high';
  if (compared >= 2 && fewest >= 2) return 'medium';
  return 'low';
}

const WORD: Record<PulseDirection, string> = {
  better: 'Better',
  worse: 'Worse',
  steady: 'Steady',
  unknown: 'Unknown',
};

export function qualityPulse(input: PulseInput): QualityPulse {
  const scored: Scored[] = VITALS.map((spec, order) => {
    const reading = spec.read(input);
    const current = finite(reading.current) ? round1(reading.current) : null;
    const previous = finite(reading.previous) ? round1(reading.previous) : null;
    const delta = current === null || previous === null ? null : round1(current - previous);
    const direction = directionOf(spec, delta);
    return {
      spec,
      order,
      // A gate that changed verdict is categorical news and outranks any numeric move.
      weight:
        delta === null
          ? 0
          : spec.unit === 'status' && Math.abs(delta) >= spec.noise
            ? Number.POSITIVE_INFINITY
            : Math.abs(delta) / spec.noise,
      vital: {
        id: spec.id,
        label: spec.label,
        unit: spec.unit,
        current,
        previous,
        delta,
        direction,
        ai: spec.ai,
      },
    };
  });
  const moved = (direction: PulseDirection) =>
    scored
      .filter((entry) => entry.vital.direction === direction)
      .sort((a, b) => b.weight - a.weight || a.order - b.order);
  const worse = moved('worse');
  const better = moved('better');
  const compared = scored.filter((entry) => entry.vital.direction !== 'unknown').length;

  let direction: PulseDirection;
  if (worse.length > 0) direction = 'worse';
  else if (better.length > 0) direction = 'better';
  else if (compared > 0) direction = 'steady';
  else direction = 'unknown';

  const lead = direction === 'worse' ? worse[0] : direction === 'better' ? better[0] : undefined;
  const cause =
    lead === undefined || lead.vital.delta === null
      ? null
      : { vital: lead.spec.id, text: phrase(lead.spec, lead.vital.delta) };
  const reason =
    cause !== null
      ? cause.text
      : direction === 'steady'
        ? `Nothing moved past its noise across ${String(compared)} signs`
        : 'Not enough evidence in both windows to compare';
  const others = direction === 'worse' ? better : [];
  return {
    projectId: input.projectId,
    evaluatedAt: input.evaluatedAt,
    windowDays: input.windowDays,
    direction,
    confidence: confidenceOf(input, compared),
    cause,
    sentence: `${WORD[direction]}: ${reason}.`,
    vitals: scored.map((entry) => entry.vital),
    alsoMoved: others.flatMap((entry) =>
      entry.vital.delta === null
        ? []
        : [{ vital: entry.spec.id, text: phrase(entry.spec, entry.vital.delta) }],
    ),
  };
}
