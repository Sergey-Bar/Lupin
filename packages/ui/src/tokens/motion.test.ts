import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOTION_SCALE_VARIABLE,
  REDUCED_MOTION_DURATION,
  REDUCED_MOTION_SCALE,
  durationVariableName,
  easingVariableName,
  motion,
  motionDurationDeclarations,
  motionEasingDeclarations,
} from './motion.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const motionCss = readFileSync(path.join(here, 'motion.css'), 'utf8');

/**
 * The body of the `prefers-reduced-motion` block.
 *
 * Found by brace-matching from the at-rule rather than by matching up to the first
 * `}`, because the block contains a nested universal selector with its own braces.
 * A regex that stopped at the first closing brace would have asserted against half
 * the rule and passed.
 */
function reducedMotionBlock(css: string): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  if (start === -1) throw new Error('motion.css emits no prefers-reduced-motion rule');
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error('the prefers-reduced-motion rule in motion.css is never closed');
}

const reduced = reducedMotionBlock(motionCss);

describe('motion tokens', () => {
  it('still ships the durations and easings it always did', () => {
    expect(Object.keys(motion.duration)).toEqual(['75', '100', '150', '200', '300']);
    expect(Object.keys(motion.easing)).toEqual(['linear', 'in', 'out', 'in-out', 'arrive']);
  });

  it('publishes every easing, so the animation shorthand names one', () => {
    // `--animate-*` has to name a timing function. Before the easings had a
    // published form, the only ways to satisfy that were to hard-code
    // `cubic-bezier(0, 0, 0.2, 1)` into the shorthand — a second copy of a value
    // this table already owns — or to leave the animation at its default curve,
    // which is why every overlay in this product used to arrive with the same
    // unconsidered easing.
    // Compared with whitespace collapsed, because Prettier wraps the long `linear()` arrival
    // curve over several lines and the value is the same value either way.
    const flat = (css: string): string =>
      css.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
    const published = flat(motionCss);
    for (const declaration of motionEasingDeclarations().split('\n')) {
      expect(published, `${declaration.trim()} is not published by motion.css`).toContain(
        flat(declaration.trim()),
      );
    }
    for (const step of Object.keys(motion.easing)) {
      expect(published).toContain(
        flat(`${easingVariableName(step)}: ${motion.easing[step as keyof typeof motion.easing]};`),
      );
    }
  });
});

/**
 * The enter/exit animations, and the utilities the components actually write.
 *
 * Sixteen class names across six components — `animate-in`, `fade-in`,
 * `fade-in-0`, `fade-in-90`, `zoom-in-95` and their `open:`-prefixed forms — were
 * written against `tailwindcss-animate`, which is not a dependency of this
 * repository. There are no `@keyframes` for them anywhere in the tree, so every
 * one compiled to nothing and the dialog, the drawer, the palette, the popover,
 * the tooltip and the empty state all appeared instantly — with their class
 * strings intact, which is why every test asserting on the class name passed.
 *
 * So they are declared as tokens rather than by adding the plugin, and these
 * assertions are what stops the same class of bug from recurring: a class in a
 * component's `className` that no `--animate-*` entry backs is a no-op that looks
 * exactly like a working one.
 */
describe('the enter and exit animations are declared, not assumed', () => {
  const ANIMATIONS = [
    '--animate-fade-in',
    '--animate-fade-out',
    '--animate-zoom-in-95',
    '--animate-zoom-out-95',
  ] as const;

  it('publishes every animation a component can ask for', () => {
    for (const name of ANIMATIONS) {
      expect(motionCss, `${name} is not published by motion.css`).toContain(`${name}: `);
    }
  });

  it('names a keyframes rule that exists, for every animation', () => {
    // The link that was missing for the sixteen dead classes: an `--animate-*`
    // entry whose keyframes name has no `@keyframes` in this stylesheet is an
    // animation that runs for its duration and changes nothing.
    for (const name of ANIMATIONS) {
      const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(motionCss)?.[1]?.trim() ?? '';
      const keyframes = declaration.split(/\s+/)[0];
      expect(keyframes, `${name} declares no keyframes name`).not.toBe('');
      expect(
        motionCss,
        `${name} animates \`${keyframes}\` and motion.css has no @keyframes for it, so the ` +
          'element changes nothing for the length of the duration',
      ).toContain(`@keyframes ${keyframes} {`);
    }
  });

  it('takes every duration from the scaled tokens rather than a literal', () => {
    // A literal time here would be unreachable by the `prefers-reduced-motion`
    // multiplier above, and the drawer would slide for a reader who asked their
    // operating system for it not to.
    for (const name of ANIMATIONS) {
      const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(motionCss)?.[1] ?? '';
      expect(declaration, `${name} hard-codes a duration`).toContain('var(--lupin-duration-');
      expect(declaration, `${name} hard-codes a timing function`).toContain('var(--lupin-ease-');
    }
  });

  it('has a keyframes rule per direction, because an overlay has to be able to leave', () => {
    // Tailwind's state variants (`data-[state=closed]:animate-fade-out`) need the
    // exit half to be a real utility. A pair where only the entry side exists is
    // an overlay that arrives and never leaves.
    for (const direction of ['enter', 'exit'] as const) {
      expect(motionCss).toContain(`@keyframes lupin-${direction} {`);
    }
  });
});

describe('the shipped stylesheet honours prefers-reduced-motion', () => {
  it('emits a prefers-reduced-motion rule at all', () => {
    // The reason this file exists: the media query appeared nowhere in the
    // repository, so a user who asked their OS to stop moving things still got a
    // drawer sliding in and a spinner turning.
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('collapses the motion scale inside that rule', () => {
    expect(reduced).toContain(`${MOTION_SCALE_VARIABLE}: ${REDUCED_MOTION_SCALE};`);
    expect(motionCss).toContain(`${MOTION_SCALE_VARIABLE}: 1;`);
  });

  it('declares every duration in terms of that scale, so one line reaches all of them', () => {
    for (const [step, value] of Object.entries(motion.duration)) {
      const variable = durationVariableName(Number(step));
      expect(motionCss, `${variable} is not published by motion.css`).toContain(
        `${variable}: calc(${value} * var(${MOTION_SCALE_VARIABLE}));`,
      );
    }
    // And the generated form is what the stylesheet actually contains, so the
    // token module and the CSS cannot drift apart unnoticed.
    for (const declaration of motionDurationDeclarations().split('\n')) {
      expect(motionCss).toContain(declaration.trim());
    }
  });

  it('reaches even a duration added after the media query was written', () => {
    // This is the property the design buys: a new duration in `motion.duration`
    // needs no second edit anywhere, because the media query changes a multiplier
    // rather than a list. If a future author hard-codes `200ms` instead, this
    // fails and the next person learns why before shipping the regression.
    const unmultiplied = Object.entries(motion.duration).filter(
      ([, value]) => !motionCss.includes(`calc(${value} * var(${MOTION_SCALE_VARIABLE}))`),
    );
    expect(
      unmultiplied.map(([step]) => step),
      'these durations ignore the motion scale and will still animate under reduce',
    ).toEqual([]);
  });

  it('neutralises the Tailwind duration and animate utilities the components actually use', () => {
    // The components set their motion with `duration-150`, `transition-all`,
    // `animate-fade-in`, `animate-zoom-in-95` and `animate-pulse`, which compile to
    // literal times. A scale variable cannot reach them, so the rule has to clamp the
    // properties themselves or the drawer still slides.
    for (const declaration of [
      `animation-duration: ${REDUCED_MOTION_DURATION} !important;`,
      'animation-iteration-count: 1 !important;',
      `transition-duration: ${REDUCED_MOTION_DURATION} !important;`,
      'scroll-behavior: auto !important;',
    ]) {
      expect(reduced).toContain(declaration);
    }
    expect(reduced).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
  });

  it('uses a non-zero reduced duration, so completion events still fire', () => {
    // `0ms`/`0s` is treated by some engines as "never start this at all", which
    // silently drops the `animationend` a component is waiting on. `0.01ms` is
    // the idiom that avoids it.
    expect(REDUCED_MOTION_DURATION).not.toBe('0ms');
    expect(REDUCED_MOTION_DURATION).not.toBe('0s');
    expect(reduced).not.toMatch(/(?:animation|transition)-duration:\s*0(?:ms|s)\b/);
  });

  it('is loaded by the stylesheet the app actually serves', () => {
    const webRoot = path.resolve(here, '../../../..');
    const indexCss = readFileSync(path.join(webRoot, 'apps/web/src/index.css'), 'utf8');
    // A rule in a file nothing imports is a rule that does not exist.
    expect(indexCss).toMatch(/@import\s+['"][^'"]*tokens\/motion\.css['"];/);
  });
});

/**
 * The arrival curve, as a CSS `linear()` easing rather than a JavaScript physics loop.
 *
 * `linear()` samples a curve the browser interpolates on the compositor, so it costs what a
 * cubic-bezier costs. The curve decelerates and lands: it starts at rest, rises without ever
 * passing its target, and settles exactly on it. A panel that goes past its edge and comes
 * back is a bounce, and a calm, flat interface has no bounce in it.
 */
describe('the arrival easing', () => {
  // Whitespace is collapsed: Prettier wraps a long `linear()` across lines.
  const declared = (/--lupin-ease-arrive:\s*linear\(([^;]+)\);/.exec(motionCss)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const stops = declared
    .split(',')
    .map((stop) => Number(stop.trim().split(/\s+/)[0]))
    .filter((value) => Number.isFinite(value));

  it('is published, and is the same value the token table owns', () => {
    expect(declared, 'motion.css publishes no --lupin-ease-arrive').not.toBe('');
    const owned = /^linear\((.*)\)$/.exec(motion.easing.arrive)?.[1]?.replace(/\s+/g, ' ').trim();
    expect(owned).toBe(declared);
  });

  it('starts at rest, settles exactly on its target, and is sampled finely enough to be smooth', () => {
    expect(stops.length).toBeGreaterThanOrEqual(12);
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
  });

  it('never overshoots, and never moves backwards', () => {
    expect(Math.max(...stops)).toBeLessThanOrEqual(1);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index], `stop ${index} moves backwards`).toBeGreaterThanOrEqual(
        stops[index - 1] ?? 0,
      );
    }
  });

  it('decelerates: it covers more ground in its first half than in its second', () => {
    const middle = stops[Math.floor(stops.length / 2)] ?? 0;
    expect(middle).toBeGreaterThan(0.5);
  });

  it('is what an anchored panel and an arriving panel enter on', () => {
    for (const name of ['--animate-fade-in', '--animate-zoom-in-95']) {
      const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(motionCss)?.[1] ?? '';
      expect(declaration, `${name} does not enter on the arrival curve`).toContain(
        'var(--lupin-ease-arrive)',
      );
    }
  });

  it('is never an exit: something leaving accelerates away', () => {
    for (const name of ['--animate-fade-out', '--animate-zoom-out-95']) {
      const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(motionCss)?.[1] ?? '';
      expect(declaration).toContain('var(--lupin-ease-in)');
    }
  });

  it('has no spring left anywhere: no easing token passes its target', () => {
    expect(motionCss).not.toContain('--lupin-ease-spring');
    expect(Object.keys(motion.easing)).not.toContain('spring');
    for (const [name, value] of Object.entries(motion.easing)) {
      const bezier = /cubic-bezier\(([^)]+)\)/.exec(value)?.[1];
      if (!bezier) continue;
      const [, y1, , y2] = bezier.split(',').map(Number);
      expect(y1, `${name} overshoots`).toBeLessThanOrEqual(1);
      expect(y2, `${name} overshoots`).toBeLessThanOrEqual(1);
      expect(y1, `${name} undershoots`).toBeGreaterThanOrEqual(0);
      expect(y2, `${name} undershoots`).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * A `--lupin-duration-*` token is already `calc(value * scale)`. Multiplying it by the scale a
 * second time squares the reduced-motion factor (0.01 becomes 0.0001), so the reduced duration
 * is no longer the one `motion.ts` documents.
 */
describe('the published animations scale their duration once', () => {
  const published = [...motionCss.matchAll(/(--animate-[\w-]+):\s*([^;]+);/g)];

  it('publishes animations to check', () => {
    expect(published.length).toBeGreaterThan(0);
  });

  it('never multiplies an already-scaled duration token by the scale again', () => {
    for (const [, name, value] of published) {
      if (!value?.includes('var(--lupin-duration-')) continue;
      expect(value, `${name} scales its duration twice`).not.toContain('var(--lupin-motion-scale)');
    }
  });
});

/** The body of the `@keyframes` block called `name`. */
function keyframesBody(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start === -1) return '';
  // A keyframes block nests one level, so the body ends at the first `}` on its own line.
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

/**
 * Calm motion: quick, short and still.
 *
 * An arrival is a fact being reported, so it is over before the reader has to wait for it, it
 * travels a few pixels rather than a share of its own height (a tall panel rising 4% moved 30px),
 * and a route change is a crossfade with no movement at all.
 */
describe('calm motion', () => {
  const durationMs = (declaration: string): number =>
    Number(/var\(--lupin-duration-(\d+)\)/.exec(declaration)?.[1] ?? Number.NaN);

  it('finishes every arrival within 150ms', () => {
    for (const name of ['--animate-fade-in', '--animate-zoom-in-95']) {
      const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(motionCss)?.[1] ?? '';
      expect(durationMs(declaration), `${name} is slower than 150ms`).toBeLessThanOrEqual(150);
    }
    const stagger = ruleBody(motionCss, '@utility stagger-in');
    expect(durationMs(stagger), 'stagger-in is slower than 150ms').toBeLessThanOrEqual(150);
  });

  it('rises a few fixed pixels on arrival, never a percentage of its own height', () => {
    const enter = keyframesBody(motionCss, 'lupin-enter');
    const rise = /translateY\(([^)]+)\)/.exec(enter)?.[1] ?? '';
    expect(rise, 'lupin-enter moves by a percentage of its own height').toMatch(/^\d+px$/);
    expect(Number.parseInt(rise, 10)).toBeLessThanOrEqual(6);
  });

  it('grows from at least 97% when anchored, so it opens rather than zooms', () => {
    const zoom = keyframesBody(motionCss, 'lupin-zoom-in');
    const from = Number(/scale\(([\d.]+)\)/.exec(zoom)?.[1]);
    expect(from).toBeGreaterThanOrEqual(0.97);
    expect(from).toBeLessThan(1);
  });

  it('holds the last row of a list back by no more than 128ms', () => {
    const max = Number(/--lupin-stagger-max:\s*(\d+)/.exec(motionCss)?.[1]);
    const step = Number(/--lupin-stagger-step:\s*calc\((\d+)ms/.exec(motionCss)?.[1]);
    expect(max * step).toBeLessThanOrEqual(128);
  });

  it('crossfades a route change with no movement', () => {
    const entering = ruleBody(motionCss, '::view-transition-new(root)');
    const keyframes = /animation:\s*([\w-]+)/.exec(entering)?.[1] ?? '';
    expect(keyframes, 'the new page enters on no keyframes').not.toBe('');
    expect(keyframesBody(motionCss, keyframes), `${keyframes} moves the page`).not.toMatch(
      /transform|translate|scale/,
    );
  });

  it('slides the indicator and the shared elements on the arrival curve', () => {
    expect(ruleBody(motionCss, '@utility indicator')).toContain('var(--lupin-ease-arrive)');
    expect(ruleBody(motionCss, '::view-transition-group(*)')).toContain('var(--lupin-ease-arrive)');
  });
});

/** The body of the rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('route changes are view transitions, and stop when motion is reduced', () => {
  it('cross-fades the old and new page on the motion tokens', () => {
    expect(motionCss).toMatch(/::view-transition-old\(root\)/);
    expect(motionCss).toMatch(/::view-transition-new\(root\)/);
    const group = ruleBody(motionCss, '::view-transition-group(*)');
    expect(group, 'the view transition takes a literal duration').toContain(
      'var(--lupin-duration-',
    );
  });

  it('clamps the view-transition pseudo-elements, which the universal selector does not reach', () => {
    // `*` matches elements, and `::view-transition-*` are pseudo-elements of the document,
    // so the global 0.01ms clamp above says nothing about them. A reader who asked for no
    // motion would still get every route change cross-faded.
    expect(reduced).toMatch(/::view-transition-group\(\*\)[\s\S]*animation-duration: 0\.01ms/);
  });
});

describe('the in-app reduce-motion preference is as strong as the operating-system one', () => {
  it('clamps literal durations and view transitions, not only the scaled tokens', () => {
    // `html[data-motion='reduced']` used to set only the multiplier, so `duration-150` on a
    // component — a literal the multiplier cannot reach — kept animating for a person who
    // had pressed "reduce motion" in this product's own settings.
    expect(motionCss).toMatch(/html\[data-motion='reduced'\]\s*\{[^}]*--lupin-motion-scale: 0\.01/);
    expect(motionCss).toMatch(
      /html\[data-motion='reduced'\] \*,[\s\S]*?transition-duration: 0\.01ms !important/,
    );
    expect(motionCss).toMatch(
      /html\[data-motion='reduced'\]::view-transition-group\(\*\)[\s\S]*?animation-duration: 0\.01ms/,
    );
  });
});

/**
 * The three roles that answer a state change the first five did not: a list arriving, a
 * selection moving, and a number changing.
 *
 * Each is held to the same two rules as the rest of the file. It takes every time from a scaled
 * token, so reduced motion reaches it without a second edit; and it animates only what the
 * compositor does for free, so it costs what a fade costs however long the list is.
 */
describe('stagger, indicator and count', () => {
  const stagger = ruleBody(motionCss, '@utility stagger-in');
  const indicator = ruleBody(motionCss, '@utility indicator');
  const count = ruleBody(motionCss, '@utility count-up');

  it('declares all three as utilities a component can write', () => {
    expect(stagger, 'no stagger-in utility').not.toBe('');
    expect(indicator, 'no indicator utility').not.toBe('');
    expect(count, 'no count-up utility').not.toBe('');
  });

  it('takes the stagger step from the scale, so reduced motion removes the wait', () => {
    const step = /--lupin-stagger-step:\s*([^;]+);/.exec(motionCss)?.[1] ?? '';
    expect(step).toContain('var(--lupin-motion-scale)');
    expect(step).toMatch(/^calc\(\d+ms \*/);
    expect(stagger).toContain('var(--lupin-stagger-step)');
  });

  it('caps the stagger, so the thirtieth row does not wait most of a second', () => {
    const max = Number(/--lupin-stagger-max:\s*(\d+)/.exec(motionCss)?.[1]);
    const step = Number(/--lupin-stagger-step:\s*calc\((\d+)ms/.exec(motionCss)?.[1]);
    expect(stagger).toContain('min(var(--stagger-index, 0), var(--lupin-stagger-max))');
    // The longest any item waits, in ms, is a decision with a ceiling: past ~250ms the list
    // reads as slow rather than as arriving in order.
    expect(max * step).toBeLessThanOrEqual(250);
  });

  it('enters on the same keyframes and arrival curve as every other arrival', () => {
    expect(stagger).toContain('lupin-enter');
    expect(stagger).toContain('var(--lupin-ease-arrive)');
    // `both` holds the first frame through the delay; without it a late item flashes visible.
    expect(stagger).toMatch(/\bboth\b/);
  });

  it('moves the indicator with translate and scale, never with a box metric', () => {
    expect(indicator).toContain('translate:');
    expect(indicator).toContain('scale:');
    const transitioned = /transition:([^;]+);/.exec(indicator)?.[1] ?? '';
    expect(transitioned).toContain('translate');
    expect(transitioned).toContain('scale');
    // `left` and `width` are layout; one of them in a transition is a reflow per frame.
    expect(transitioned).not.toMatch(/\b(left|width|height|top|margin)\b/);
  });

  it('times every indicator transition from the scaled tokens', () => {
    const transitioned = /transition:([^;]+);/.exec(indicator)?.[1] ?? '';
    for (const part of transitioned.split(',')) {
      expect(part, `"${part.trim()}" has a literal time`).toContain('var(--lupin-duration-');
    }
  });

  it('registers the count as an integer, so the browser can interpolate it', () => {
    expect(motionCss).toMatch(/@property --lupin-count\s*\{[^}]*syntax:\s*'<integer>'/);
    expect(motionCss).toContain('@keyframes lupin-count {');
    expect(count).toContain('lupin-count');
    expect(count).toContain('var(--lupin-duration-');
  });

  it('shows the target, not zero, in a browser that cannot animate the property', () => {
    // Without `@property` support the animation is ignored and this declaration is what shows.
    expect(count).toContain('--lupin-count: var(--count-to, 0);');
  });

  it('is reached by the reduced-motion clamp, because it uses no literal duration', () => {
    // The clamp sets `animation-duration` on every element, and the scale zeroes the tokens;
    // a literal `ms` in any of the three would survive both.
    for (const [name, body] of [
      ['stagger-in', stagger],
      ['indicator', indicator],
      ['count-up', count],
    ] as const) {
      // A time is digits then `ms` or `s`, not preceded by a name character (`--x-24ms`) or a dot.
      const literalTimes = [...body.matchAll(/(?<![-\w.])(\d+)m?s\b/g)];
      expect(literalTimes, `${name} hard-codes a time`).toEqual([]);
    }
  });
});

/**
 * Design language v2: an expressive tier for the hero and a page's first screen, beside the
 * calm tier every control keeps. It is still calm by this file's definition (no overshoot, a
 * token duration the reduced-motion scale reaches) and is bounded so it cannot become travel.
 */
describe('the expressive tier', () => {
  const declaration = /--animate-reveal:\s*([^;]+);/.exec(motionCss)?.[1] ?? '';
  const keyframes = /@keyframes lupin-reveal \{([\s\S]*?)\n\}/.exec(motionCss)?.[1] ?? '';

  it('publishes a reveal animation on the arrival curve, from a scaled token', () => {
    expect(declaration).toContain('lupin-reveal');
    expect(declaration).toContain('var(--lupin-ease-arrive)');
    expect(declaration).toMatch(/var\(--lupin-duration-(\d+)\)/);
  });

  it('takes at most 300ms, so the hero lands before the reader looks for it', () => {
    const step = Number(/var\(--lupin-duration-(\d+)\)/.exec(declaration)?.[1]);
    expect(step).toBeLessThanOrEqual(300);
  });

  it('rises between 8 and 12px: more than a control, never far enough to read as travel', () => {
    const rise = Number(/translateY\((\d+)px\)/.exec(keyframes)?.[1]);
    expect(rise).toBeGreaterThanOrEqual(8);
    expect(rise).toBeLessThanOrEqual(12);
  });
});
