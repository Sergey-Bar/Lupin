import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSEMBLY_END,
  constructionEdge,
  paintSwarm,
} from '../../site/.vitepress/theme/nano-field.ts';

const palette = {
  foreground: 'foreground',
  muted: 'muted',
  edge: 'edge',
  background: 'background',
};

/**
 * A context that records every call, typed as the swarm's own context.
 *
 * @returns {{ context: import('../../site/.vitepress/theme/nano-field.ts').SwarmContext, calls: Array<{ method: string, args?: number[], color?: unknown, opacity?: number, lineWidth?: number }> }}
 */
function recordingContext() {
  /** @type {Array<{ method: string, args?: number[], color?: unknown, opacity?: number, lineWidth?: number }>} */
  const calls = [];
  /** @param {string} method */
  const record =
    (method) =>
    /** @param {number[]} args */
    (...args) => {
      calls.push({ method, args });
    };
  /** @type {import('../../site/.vitepress/theme/nano-field.ts').SwarmContext} */
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    rect: record('rect'),
    fill: () => {
      calls.push({ method: 'fill', color: context.fillStyle, opacity: context.globalAlpha });
    },
    stroke: () => {
      calls.push({
        method: 'stroke',
        color: context.strokeStyle,
        opacity: context.globalAlpha,
        lineWidth: context.lineWidth,
      });
    },
  };
  return { context, calls };
}

test('construction starts outside the content and fully clears it at every sampled height', () => {
  for (const width of [1, 320, 768, 1440, 2560]) {
    for (const verticalPosition of [0, 0.1, 0.25, 0.5, 0.75, 1, 1.05]) {
      assert.ok(constructionEdge(verticalPosition, 0, width) < 0);
      assert.ok(constructionEdge(verticalPosition, 1, width) > width);
      assert.equal(
        constructionEdge(verticalPosition, -1, width),
        constructionEdge(verticalPosition, 0, width),
      );
      assert.equal(
        constructionEdge(verticalPosition, 2, width),
        constructionEdge(verticalPosition, 1, width),
      );
    }
  }
});

test('a completed frame clears its canvas without leaving a mask or drawing particles', () => {
  const bounds = { width: 1280, height: 450, contentWidth: 900, inset: 190 };
  for (const elapsed of [ASSEMBLY_END, ASSEMBLY_END + 1]) {
    const { context, calls } = recordingContext();
    paintSwarm(context, bounds, palette, elapsed);
    assert.deepEqual(calls, [{ method: 'clearRect', args: [0, 0, 1280, 450] }]);
  }
});

test('the delay masks only the content and emits no particles', () => {
  const { context, calls } = recordingContext();
  const bounds = { width: 1280, height: 400, contentWidth: 800, inset: 240 };
  paintSwarm(context, bounds, palette, -0.5);
  assert.equal(calls.filter(({ method }) => method === 'rect').length, 0);
  const fills = calls.filter(({ method }) => method === 'fill');
  assert.deepEqual(fills, [{ method: 'fill', color: palette.background, opacity: 1 }]);
  for (const { args = [] } of calls.filter(({ method }) => ['moveTo', 'lineTo'].includes(method))) {
    const [x = Number.NaN] = args;
    assert.ok(x >= bounds.inset && x <= bounds.inset + bounds.contentWidth);
  }
});

test('dense and reduced swarms use a bounded draw batch with finite geometry', () => {
  let fullParticleCount = 0;
  for (const stride of [1, 2, 3]) {
    const { context, calls } = recordingContext();
    paintSwarm(
      context,
      { width: 390, height: 600, contentWidth: 350, inset: 20 },
      palette,
      1.8,
      stride,
    );
    const rectangles = calls.filter(({ method }) => method === 'rect');
    const fills = calls.filter(({ method }) => method === 'fill');
    assert.ok(fills.length <= 6, 'one mask, one skin and at most four particle layers');
    assert.ok(
      calls.filter(({ method }) => method === 'stroke').length <= 1,
      'facets use one stroke batch',
    );
    assert.ok(rectangles.length > 1000 && rectangles.length <= 20000, 'dense but bounded geometry');
    if (stride === 1) fullParticleCount = rectangles.length;
    else
      assert.ok(rectangles.length < fullParticleCount, 'slower devices receive less drawing work');
    for (const { args = [] } of rectangles) assert.ok(args.every(Number.isFinite));
    for (const { opacity = Number.NaN } of fills) assert.ok(opacity >= 0 && opacity <= 1);
    assert.equal(context.globalAlpha, 1, 'drawing restores the caller opacity');
  }
});

test('zero-size surfaces are cleared without starting particle work', () => {
  for (const [width, height] of [
    [0, 500],
    [500, 0],
  ]) {
    const { context, calls } = recordingContext();
    paintSwarm(context, { width, height, contentWidth: width, inset: 0 }, palette, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'clearRect');
  }
});
