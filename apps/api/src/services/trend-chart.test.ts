import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CockpitPaceWeek } from '@lupin/shared-contracts';
import {
  CHART_ALT,
  CHART_HEIGHT,
  CHART_LAYOUT,
  CHART_PALETTE,
  CHART_WIDTH,
  encodePng,
  hasChartData,
  renderPaceChart,
  weekCentreX,
} from './trend-chart.js';

const week = (index: number, extra: Partial<CockpitPaceWeek> = {}): CockpitPaceWeek => ({
  weekStart: new Date(Date.UTC(2026, 7, 10 + index * 7)).toISOString().slice(0, 10),
  partial: index === 11,
  merged: 0,
  linesChanged: 0,
  aiAuthored: 0,
  unattributed: 0,
  aiShare: null,
  score: null,
  formulaVersion: null,
  ...extra,
});

const weeks = (extra: (index: number) => Partial<CockpitPaceWeek> = () => ({})) =>
  Array.from({ length: 12 }, (_, index) => week(index, extra(index)));

/** A PNG read back: its chunks with their CRCs checked, and the pixels. */
function decode(png: Uint8Array) {
  const buffer = Buffer.from(png);
  expect([...buffer.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const stored = buffer.readUInt32BE(offset + 8 + length);
    expect(stored, `CRC of ${type}`).toBe(crc32(buffer.subarray(offset + 4, offset + 8 + length)));
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const header = chunks.find((entry) => entry.type === 'IHDR')?.data as Buffer;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)),
  );
  const stride = width * 3;
  expect(raw.length).toBe((stride + 1) * height);
  const pixel = (x: number, y: number): [number, number, number] => {
    expect(raw[y * (stride + 1)], `row ${String(y)} filter`).toBe(0);
    const at = y * (stride + 1) + 1 + x * 3;
    return [raw[at] as number, raw[at + 1] as number, raw[at + 2] as number];
  };
  return { chunks, header, width, height, pixel };
}

const near = (actual: readonly number[], expected: readonly number[], tolerance = 2) =>
  actual.every((value, index) => Math.abs(value - (expected[index] as number)) <= tolerance);

describe('encodePng', () => {
  it('writes a PNG that reads back: signature, header, data, end, every CRC right', () => {
    const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    const image = decode(encodePng(2, 2, rgb));
    expect(image.chunks.map((entry) => entry.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect([image.width, image.height]).toEqual([2, 2]);
    // 8 bits per channel, truecolour, no interlace.
    expect([...image.header.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
    expect(image.pixel(0, 0)).toEqual([255, 0, 0]);
    expect(image.pixel(1, 0)).toEqual([0, 255, 0]);
    expect(image.pixel(0, 1)).toEqual([0, 0, 255]);
    expect(image.pixel(1, 1)).toEqual([10, 20, 30]);
  });

  it('refuses a pixel buffer that is not the size it was told', () => {
    expect(() => encodePng(2, 2, new Uint8Array(5))).toThrow(RangeError);
  });
});

describe('renderPaceChart', () => {
  it('draws a 720 by 240 image, of the size it says, with alternative text', () => {
    const chart = renderPaceChart(weeks());
    const image = decode(chart.png);
    expect([image.width, image.height]).toEqual([CHART_WIDTH, CHART_HEIGHT]);
    expect([chart.width, chart.height]).toEqual([CHART_WIDTH, CHART_HEIGHT]);
    expect(chart.alt).toBe(CHART_ALT);
    expect(chart.alt.length).toBeGreaterThan(40);
  });

  it('is the same bytes for the same weeks, so a retry sends the same picture', () => {
    const input = weeks((index) => ({ merged: index % 4, score: 60 + index, formulaVersion: 1 }));
    expect(
      Buffer.from(renderPaceChart(input).png).equals(Buffer.from(renderPaceChart(input).png)),
    ).toBe(true);
  });

  it('leaves the plate white and draws the two baselines', () => {
    const image = decode(renderPaceChart(weeks()).png);
    expect(image.pixel(2, 2)).toEqual([...CHART_PALETTE.background]);
    expect(image.pixel(CHART_WIDTH - 3, CHART_HEIGHT - 3)).toEqual([...CHART_PALETTE.background]);
    expect(near(image.pixel(100, CHART_LAYOUT.barsBottom), CHART_PALETTE.grid)).toBe(true);
    expect(near(image.pixel(100, CHART_LAYOUT.lineBottom), CHART_PALETTE.grid)).toBe(true);
  });

  it('draws a bar where something merged, and none where nothing did', () => {
    const image = decode(renderPaceChart(weeks((index) => (index === 3 ? { merged: 4 } : {}))).png);
    const above = CHART_LAYOUT.barsBottom - 20;
    expect(near(image.pixel(Math.round(weekCentreX(3, 12)), above), CHART_PALETTE.bar)).toBe(true);
    expect(image.pixel(Math.round(weekCentreX(4, 12)), above)).toEqual([
      ...CHART_PALETTE.background,
    ]);
    expect(image.pixel(Math.round(weekCentreX(2, 12)), above)).toEqual([
      ...CHART_PALETTE.background,
    ]);
  });

  it('stacks the part an agent wrote under the rest, in its own colour', () => {
    const image = decode(
      renderPaceChart(weeks((index) => (index === 3 ? { merged: 4, aiAuthored: 2 } : {}))).png,
    );
    const x = Math.round(weekCentreX(3, 12));
    // The busiest week fills the plot, so half the height is the agent's and half is the rest.
    const height = CHART_LAYOUT.barsBottom - CHART_LAYOUT.barsTop;
    expect(
      near(
        image.pixel(x, CHART_LAYOUT.barsBottom - Math.round(height * 0.25)),
        CHART_PALETTE.agent,
      ),
    ).toBe(true);
    expect(
      near(image.pixel(x, CHART_LAYOUT.barsBottom - Math.round(height * 0.75)), CHART_PALETTE.bar),
    ).toBe(true);
  });

  it('draws the week still in progress paler than a finished one', () => {
    const image = decode(
      renderPaceChart(weeks((index) => (index === 3 || index === 11 ? { merged: 2 } : {}))).png,
    );
    const y = CHART_LAYOUT.barsBottom - 10;
    const full = image.pixel(Math.round(weekCentreX(3, 12)), y);
    const partial = image.pixel(Math.round(weekCentreX(11, 12)), y);
    expect(near(full, CHART_PALETTE.bar)).toBe(true);
    expect(partial[0]).toBeGreaterThan(full[0] + 40);
    expect(partial).not.toEqual([...CHART_PALETTE.background]);
  });

  it('puts a higher score higher on the page', () => {
    const image = decode(
      renderPaceChart(
        weeks((index) =>
          index === 2
            ? { score: 90, formulaVersion: 1 }
            : index === 8
              ? { score: 30, formulaVersion: 1 }
              : {},
        ),
      ).png,
    );
    const height = CHART_LAYOUT.lineBottom - CHART_LAYOUT.lineTop;
    const dot = (index: number, score: number) =>
      image.pixel(
        Math.round(weekCentreX(index, 12)),
        Math.round(CHART_LAYOUT.lineBottom - (score / 100) * height),
      );
    expect(near(dot(2, 90), CHART_PALETTE.line)).toBe(true);
    expect(near(dot(8, 30), CHART_PALETTE.line)).toBe(true);
    // And not at the other one's height.
    expect(dot(2, 30)).toEqual([...CHART_PALETTE.background]);
  });

  it('joins neighbouring graded weeks into a line', () => {
    const image = decode(
      renderPaceChart(
        weeks((index) => (index === 4 || index === 5 ? { score: 50, formulaVersion: 1 } : {})),
      ).png,
    );
    const between = Math.round((weekCentreX(4, 12) + weekCentreX(5, 12)) / 2);
    const y = Math.round(
      CHART_LAYOUT.lineBottom - 0.5 * (CHART_LAYOUT.lineBottom - CHART_LAYOUT.lineTop),
    );
    expect(near(image.pixel(between, y), CHART_PALETTE.line)).toBe(true);
  });

  it('leaves a gap where no score was recorded instead of leaning across it', () => {
    const image = decode(
      renderPaceChart(
        weeks((index) => (index === 4 || index === 6 ? { score: 50, formulaVersion: 1 } : {})),
      ).png,
    );
    const middle = Math.round(weekCentreX(5, 12));
    const y = Math.round(
      CHART_LAYOUT.lineBottom - 0.5 * (CHART_LAYOUT.lineBottom - CHART_LAYOUT.lineTop),
    );
    expect(image.pixel(middle, y)).toEqual([...CHART_PALETTE.background]);
  });

  it('breaks the line where the formula changed, and marks where', () => {
    const image = decode(
      renderPaceChart(
        weeks((index) =>
          index === 4
            ? { score: 50, formulaVersion: 1 }
            : index === 5
              ? { score: 50, formulaVersion: 2 }
              : {},
        ),
      ).png,
    );
    const breakX = Math.round((weekCentreX(4, 12) + weekCentreX(5, 12)) / 2);
    const y = Math.round(
      CHART_LAYOUT.lineBottom - 0.5 * (CHART_LAYOUT.lineBottom - CHART_LAYOUT.lineTop),
    );
    // Not the line's colour at the midpoint: the two dots are not joined.
    expect(near(image.pixel(breakX, y), CHART_PALETTE.line)).toBe(false);
    // The dashed mark: somewhere down that column is the break colour.
    let marked = false;
    for (let at = CHART_LAYOUT.lineTop; at < CHART_LAYOUT.lineBottom; at += 1) {
      for (const x of [breakX - 1, breakX, breakX + 1]) {
        if (near(image.pixel(x, at), CHART_PALETTE.formulaBreak, 40)) marked = true;
      }
    }
    expect(marked).toBe(true);
  });

  it('stays small enough for a data address in a card', () => {
    const busy = weeks((index) => ({
      merged: (index * 7) % 9,
      aiAuthored: (index * 3) % 4,
      score: 40 + ((index * 11) % 50),
      formulaVersion: index < 6 ? 1 : 2,
    }));
    expect(renderPaceChart(busy).png.length).toBeLessThan(16_000);
  });

  it('handles no weeks without drawing outside the plate', () => {
    const chart = renderPaceChart([]);
    expect(decode(chart.png).pixel(5, 5)).toEqual([...CHART_PALETTE.background]);
  });
});

describe('hasChartData', () => {
  it('is false when nothing merged and nothing was scored, true when either was', () => {
    expect(hasChartData(weeks())).toBe(false);
    expect(hasChartData(weeks((index) => (index === 2 ? { merged: 1 } : {})))).toBe(true);
    expect(
      hasChartData(weeks((index) => (index === 2 ? { score: 0, formulaVersion: 1 } : {}))),
    ).toBe(true);
  });
});

describe('the palette', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(
    path.resolve(here, '../../../../packages/ui/src/tokens/theme.css'),
    'utf8',
  );

  /** The light theme's block, where the chart tokens are declared with light-plate values. */
  const light = (() => {
    const start = css.indexOf("[data-theme='light'] {");
    return css.slice(start, css.indexOf('}', start));
  })();

  function oklchToRgb(l: number, c: number, h: number): number[] {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;
    const [lc, mc, sc] = [l_ ** 3, m_ ** 3, s_ ** 3] as const;
    const linear = [
      4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
      -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
      -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
    ];
    return linear.map((value) => {
      const clamped = Math.min(1, Math.max(0, value));
      const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(gamma * 255);
    });
  }

  function token(name: string): number[] {
    const match = new RegExp(
      `--lupin-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`,
    ).exec(light);
    if (match === null) throw new Error(`--lupin-${name} is not an oklch() in the light theme`);
    return oklchToRgb(Number(match[1]) / 100, Number(match[2]), Number(match[3]));
  }

  it.each([
    ['background', 'surface'],
    ['grid', 'chart-grid'],
    ['bar', 'chart-1'],
    ['agent', 'chart-2'],
    ['line', 'chart-line'],
    ['formulaBreak', 'warning'],
  ] as const)('draws %s in the colour of --lupin-%s', (colour, tokenName) => {
    expect(near(CHART_PALETTE[colour], token(tokenName), 2), `${colour} vs ${tokenName}`).toBe(
      true,
    );
  });
});
