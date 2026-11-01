import { crc32, deflateSync } from 'node:zlib';
import type { CockpitPaceWeek } from '@lupin/shared-contracts';

/**
 * The cockpit's pace chart as a PNG, for a message that has no way to run our web app.
 *
 * Slack, Telegram and Teams show a picture and nothing else: no script, no stylesheet, no
 * SVG. So the chart is drawn into a pixel buffer here and encoded as a PNG, with no library.
 * A rasterising library is a native binary or a WebAssembly module in the API's image, a new
 * thing to patch and to trust, for a chart of twelve bars and a line. A PNG is a signature
 * and four kinds of chunk; the encoder is below and `trend-chart.test.ts` decodes what it
 * writes and reads pixels back.
 *
 * What it draws is the web chart's: pull requests merged each week as bars, the part an agent
 * wrote under the rest, and the score for the same weeks as a line beneath, with a gap where
 * no score was recorded and a dashed mark where the formula changed. There is no text in the
 * image on purpose: the numbers are in the message beside it, and a bitmap font would be a
 * second thing to keep in step with the type the product ships.
 *
 * The colours are the light theme's chart tokens as sRGB, because a chat shows the picture on
 * whatever background the reader has and a light plate survives both. They are not a second
 * palette: the test reads `theme.css` and fails if one drifts from its token.
 */
export const CHART_WIDTH = 720;
export const CHART_HEIGHT = 240;

type Rgb = readonly [number, number, number];

/** `--lupin-surface`, `--lupin-chart-grid`, `--lupin-chart-1`, `--lupin-chart-2`, `--lupin-warning` (light). */
export const CHART_PALETTE = {
  background: [255, 255, 255],
  grid: [228, 228, 231],
  bar: [0, 95, 176],
  agent: [163, 104, 0],
  line: [0, 95, 176],
  formulaBreak: [126, 84, 21],
} as const satisfies Record<string, Rgb>;

/** Where the two plots sit, in image pixels. Exported so a test can find a bar or a point. */
export const CHART_LAYOUT = {
  left: 12,
  right: CHART_WIDTH - 12,
  barsTop: 12,
  barsBottom: 102,
  lineTop: 126,
  lineBottom: 216,
} as const;

/** Drawn at this many times the size and averaged down, which is what makes the edges smooth. */
const SCALE = 2;
const PARTIAL_MIX = 0.5;

class Canvas {
  readonly width: number;
  readonly height: number;
  private readonly data: Uint8Array;

  constructor(width: number, height: number, background: Rgb) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
      this.data.set(background, index * 3);
    }
  }

  private set(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(color, (y * this.width + x) * 3);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, color: Rgb): void {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) this.set(x, y, color);
    }
  }

  disc(cx: number, cy: number, radius: number, color: Rgb): void {
    const reach = Math.ceil(radius);
    for (let y = Math.floor(cy) - reach; y <= Math.floor(cy) + reach; y += 1) {
      for (let x = Math.floor(cx) - reach; x <= Math.floor(cx) + reach; x += 1) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) this.set(x, y, color);
      }
    }
  }

  /** A line of the given thickness, stamped as discs half a pixel apart. */
  line(x0: number, y0: number, x1: number, y1: number, thickness: number, color: Rgb): void {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length * 2));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness / 2, color);
    }
  }

  /** One channel of the `factor` by `factor` block whose top left is (`x`, `y`), averaged. */
  private blockAverage(x: number, y: number, channel: number, factor: number): number {
    let sum = 0;
    for (let dy = 0; dy < factor; dy += 1) {
      for (let dx = 0; dx < factor; dx += 1) {
        sum += this.data[((y + dy) * this.width + x + dx) * 3 + channel] as number;
      }
    }
    return Math.round(sum / (factor * factor));
  }

  /** The canvas averaged down by `factor`, as the rows PNG wants: RGB, top to bottom. */
  downsample(factor: number): { width: number; height: number; data: Uint8Array } {
    const width = Math.floor(this.width / factor);
    const height = Math.floor(this.height / factor);
    const out = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          out[(y * width + x) * 3 + channel] = this.blockAverage(
            x * factor,
            y * factor,
            channel,
            factor,
          );
        }
      }
    }
    return { width, height, data: out };
  }
}
const mix = (color: Rgb, toward: Rgb, amount: number): Rgb => [
  Math.round(color[0] + (toward[0] - color[0]) * amount),
  Math.round(color[1] + (toward[1] - color[1]) * amount),
  Math.round(color[2] + (toward[2] - color[2]) * amount),
];

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** An 8-bit RGB PNG, rows unfiltered. Small charts of flat colour compress to a few kilobytes. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (rgb.length !== width * height * 3) {
    throw new RangeError('The pixel buffer does not match the image size');
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    // Filter type 0 (none) at the head of every row.
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The centre of week `index` of `count`, in image pixels. */
export function weekCentreX(index: number, count: number): number {
  const step = (CHART_LAYOUT.right - CHART_LAYOUT.left) / Math.max(1, count);
  return CHART_LAYOUT.left + step * index + step / 2;
}

/** Whether there is anything to draw: a week with a merged change or a score. */
export function hasChartData(pace: readonly CockpitPaceWeek[]): boolean {
  return pace.some((week) => week.merged > 0 || week.score !== null);
}

export interface TrendChart {
  png: Uint8Array;
  width: number;
  height: number;
  /** What the picture shows, for the platforms that take alternative text. */
  alt: string;
}

export const CHART_ALT =
  'Pull requests merged each week for the last twelve weeks, with the part an agent wrote in amber, above the score for the same weeks.';

export function renderPaceChart(pace: readonly CockpitPaceWeek[]): TrendChart {
  const { left, right, barsTop, barsBottom, lineTop, lineBottom } = CHART_LAYOUT;
  const canvas = new Canvas(CHART_WIDTH * SCALE, CHART_HEIGHT * SCALE, CHART_PALETTE.background);
  const s = (value: number) => value * SCALE;

  // Baselines, under everything.
  canvas.fillRect(s(left), s(barsBottom), s(right), s(barsBottom) + SCALE, CHART_PALETTE.grid);
  canvas.fillRect(s(left), s(lineBottom), s(right), s(lineBottom) + SCALE, CHART_PALETTE.grid);

  const count = pace.length;
  const step = (right - left) / Math.max(1, count);
  const barWidth = step * 0.62;
  const maxMerged = Math.max(1, ...pace.map((week) => week.merged));
  const barsHeight = barsBottom - barsTop;

  pace.forEach((week, index) => {
    if (week.merged === 0) return;
    const centre = weekCentreX(index, count);
    const aiHeight = (week.aiAuthored / maxMerged) * barsHeight;
    const otherHeight = ((week.merged - week.aiAuthored) / maxMerged) * barsHeight;
    // The week still in progress is paler: its bar is not yet a week's.
    const bar = week.partial
      ? mix(CHART_PALETTE.bar, CHART_PALETTE.background, PARTIAL_MIX)
      : CHART_PALETTE.bar;
    const agent = week.partial
      ? mix(CHART_PALETTE.agent, CHART_PALETTE.background, PARTIAL_MIX)
      : CHART_PALETTE.agent;
    const x0 = s(centre - barWidth / 2);
    const x1 = s(centre + barWidth / 2);
    canvas.fillRect(x0, s(barsBottom - aiHeight), x1, s(barsBottom), agent);
    canvas.fillRect(x0, s(barsBottom - aiHeight - otherHeight), x1, s(barsBottom - aiHeight), bar);
  });

  // The score: a line joined only across weeks graded by the same formula and with no gap.
  const lineHeight = lineBottom - lineTop;
  let previous: { x: number; y: number; version: number | null } | null = null;
  pace.forEach((week, index) => {
    if (week.score === null) {
      previous = null;
      return;
    }
    const x = weekCentreX(index, count);
    const y = lineBottom - (week.score / 100) * lineHeight;
    if (previous !== null && previous.version !== week.formulaVersion) {
      // A different formula: the two are not on one scale, so they are not joined, and a
      // dashed mark says why the line stops.
      const breakX = (previous.x + x) / 2;
      for (let at = lineTop; at < lineBottom; at += 8) {
        canvas.fillRect(
          s(breakX) - 2,
          s(at),
          s(breakX) + 2,
          s(Math.min(at + 4, lineBottom)),
          CHART_PALETTE.formulaBreak,
        );
      }
      previous = null;
    }
    if (previous !== null)
      canvas.line(s(previous.x), s(previous.y), s(x), s(y), s(2), CHART_PALETTE.line);
    canvas.disc(s(x), s(y), s(3), CHART_PALETTE.line);
    previous = { x, y, version: week.formulaVersion };
  });

  const image = canvas.downsample(SCALE);
  return {
    png: encodePng(image.width, image.height, image.data),
    width: image.width,
    height: image.height,
    alt: CHART_ALT,
  };
}
