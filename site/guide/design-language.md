---
title: The design language
description: A flat plane, the Lupin violet, Geist, calm motion and one translucent material for what floats — and the numbers every token has to clear.
---

# The design language

This page is the written half of a decision that is also machine-checked. Every colour,
type face, duration and motion utility described here is declared in
`packages/ui/src/tokens/` and asserted by `theme.test.ts`, `fonts.test.ts` and
`motion.test.ts`; `apps/web/src/theme-resolution.test.ts` proves that every utility any
component writes actually generates. Where this page says a token owes 4.5:1, there is
an assertion per theme, per plane step, that fails if it stops.

The console and this site are one design. The site imports the product's token files and
adds layout only; `pnpm site:doctor` check 8 fails on a literal colour in any site
stylesheet.

::: tip Changing something here
Change the token and run the tests. A literal colour in a component is a build
failure, and a colour in this page that is not in `theme.css` is a page that has
drifted from the product.
:::

## The principle

**A quiet plane, one brand colour, and colour elsewhere is meaning.** The product is an
instrument: a QA engineer opens it to learn what is wrong and what is good. So the plane is
near-neutral in four opaque steps, the brand is a single violet used for focus, links, the
active state and the one primary action, and every other colour on screen is a verdict —
pass, warn, fail, flaky — or a chart series. Things that float above the plane may be
translucent; nothing a reader is meant to read sits behind glass.

## Colour is declared in OKLCH

Every colour in `theme.css` is an `oklch(L% C H)` literal, because those three numbers are
the three decisions — lightness, chroma, hue — and a hex literal hides all of them. Each
literal round-trips to one 8-bit sRGB value, and that value is what the WCAG arithmetic in
`theme.test.ts` measures. Beside the WCAG 2 ratio, the text tokens are held to an **APCA**
floor — Lc 90 for body text, Lc 60 for the accent and the primary-button label, Lc 50 for
muted helper text — because WCAG 2 over-rates light text on a dark plane and APCA does not.

## The plane

Four steps, and the names do not change between themes — the plane is what inverts.

| Token                    | Dark                    | Light                   | What it is for                                                    |
| ------------------------ | ----------------------- | ----------------------- | ----------------------------------------------------------------- |
| `--lupin-surface-sunken` | `oklch(17.8% .006 271)` | `oklch(93.6% .004 106)` | The page behind the panels, and the evidence surfaces inside them |
| `--lupin-surface`        | `oklch(21.5% .010 277)` | `oklch(100% 0 0)`       | A panel. The base                                                 |
| `--lupin-surface-raised` | `oklch(23.6% .010 277)` | `oklch(99.1% .001 106)` | A control sitting on the base, and every overlay                  |
| `--lupin-surface-muted`  | `oklch(25.7% .010 277)` | `oklch(96.7% .003 106)` | The recessed fill inside a control                                |

The near is a decision. The dark plane carries the violet's undertone (hue about 276) so
the brand reads as part of the room; the light plane is warm paper (hue about 106). Every
plane step, both foregrounds and the decorative border stay under 0.012 chroma — a
temperature, never a colour.

In dark mode the plane gets **lighter** as it rises; in light mode it gets **closer to
white**. `theme.test.ts` checks that `surface-sunken` is the darkest step in both themes,
that `surface-raised` lies strictly between the base and the inset, and that the direction
from base to inset is opposite in the two themes. There is no fifth surface.

### Shape

Two radii, for two kinds of surface. Everything that sits **on** the page — a panel, a card,
a figure, a control — uses the panel radius (8px) or the control radius (6px), the radii the
site uses. The 12px cap belongs to the overlays that float above the page, so a corner is
one of the cues that a surface is floating. Default controls are **44px** tall — the
WCAG 2.5.5 target and the site's button height — and one test holds `Button`, `Input` and
`Select` in agreement.

### Elevation

Depth on the page comes from the plane step and the space around a surface; a panel carries
no shadow and no outline, and a figure is a number on the page rather than a number in a
box. A shadow is for something that floats, and each step is a **stack of neutral layers** — a
tight contact shadow and a wide soft one, the way light from above falls — with each higher
step adding a layer and reaching further. Step 1 is rare, step 2 is a popover or a toast,
step 3 a dialog or the command palette. The light theme re-declares all three at low alpha,
because on white a dark-plane shadow is a smudge. `theme.test.ts` asserts the layering, the
growing reach and that every layer is black at some alpha.

### The chart palette

Charts have their own roles — `chart-pass`, `chart-fail`, `chart-flaky`, `chart-skipped`,
`chart-line`, `chart-grid` and a six-step series `chart-1…6` — derived from Okabe and Ito's
colour-universal palette and tuned per theme. Every mark is at least 3:1 on every plane step
(WCAG 1.4.11), every pair of run states is at least 0.12 OKLab ΔE apart normally and 0.06
under a deuteranopia simulation, and the gridline stays a guide (between 1.05:1 and 3:1).

### Every dialog has three ways out

A close button in the header, a click on the backdrop, and Escape. Escape alone was the
toolbox's defect (`UX-DIALOG-1`): a phone has no Escape key. Focus opens on the title, not
the first button, so no action is armed before the dialog has been read.

## The accent

`--lupin-accent` is the Lupin violet: `oklch(50.9% .138 290)` on the light plane and a
lifted `oklch(79.3% .089 293)` on the dark one — the colour of the dot in the wordmark.
`theme.test.ts` holds it in the violet hue band (280–300), above 0.08 chroma, at 4.5:1 and
APCA Lc 60 as text on every plane step, and at least 20 degrees of hue from `info`, so the
brand is never read as a note.

It is allowed in four places: the focus ring, the active state (the current section, a
selected tab), a link, and the one solid primary fill per screen — a violet button with a
white label in light, a lavender button with a near-black label in dark. It is never a
large plane and never a verdict.

## Run state, and why `info` is quieter

| Token             | OKLCH hue | What it means                     |
| ----------------- | --------- | --------------------------------- |
| `--lupin-success` | 148       | Passed                            |
| `--lupin-warning` | 72        | Needs a decision                  |
| `--lupin-danger`  | 25        | Failed                            |
| `--lupin-info`    | 258       | A note — steel, quieter than both |

Every run state is at least half as saturated again as info, the three run states keep 20
degrees or more of hue between them, and each lands within 3 degrees of its decided hue.
**A status is never colour alone**: a verdict is a dot _and_ a word, a trend an icon _and_
a screen-reader label. **Monochrome first**: a `Badge` is a word in the foreground with a
6px dot beside it, and only the dot carries the run-state colour, so a list of runs reads as
text with a few points of colour rather than a field of filled pills. Status colours are also body text in `Alert` and `Toast`, so they owe
4.5:1 against their own 10% tint, measured as the blend the browser paints.

## Two borders, because 1.4.11 is not about every border

`--lupin-border` is decoration — a card outline, a divider, a table rule — and sits below
3:1 **on purpose**. `--lupin-border-strong` is the edge that is the _only_ thing
delineating a control, which WCAG 1.4.11 does cover: it clears 3:1 against every plane
step, and `Input`, `Select`, `Textarea` and `Toggle` draw their edge with it. A test holds
every field's resting edge to it, because the three text fields once drew their only edge
in the decorative border.

## Type

Two families, and the rule is which of them a string is.

- **Geist** for everything that is read.
- **Geist Mono** for everything that is a reading: run ids, digests, stack traces, JUnit
  output, and every column of numbers, in `tabular-nums`.

The two faces share one vertical design, so a run id beside a sentence sits on the same
baseline and x-height. Both are variable (`wght` 100–900), woff2, committed once in
`packages/ui/src/assets/fonts/` with the upstream repository, the commit, the OFL licence
file and a sha256 in `fonts-lock.json`; `fonts.test.ts` checks the lock in both directions.

**Optical size, without an optical axis.** Geist has no `opsz`, so the correction a display
cut would make is made in the type ladder: every step carries its own letter-spacing,
closing up as the size grows (+0.01em at 12px to −0.035em at the display step), and the
steps from 24px up carry a heading weight between 550 and 650. `theme.test.ts` asserts both
relations rather than a list of values.

### Type on the page

A page leads with its title at display size: `PageHeader` sets the `h1` at `text-3xl`,
`text-4xl` from `sm` and `text-5xl` from `lg`, with a one-line subtitle at body size. Panel
titles are `text-base` semibold, figures are `text-3xl`/`text-4xl`, and the one hero figure
a screen may have is a step larger. Pages and panels breathe at 16–24px gaps.
`apps/web/src/components/kit.test.tsx` fails on a page title below display size, a figure
in a box, or a panel with an outline.

### The fallback faces

`Geist Fallback` (local Arial) and `Geist Mono Fallback` (local Consolas) carry metrics
overrides read out of each binary's `hhea` and `OS/2` tables, so the swap does not move a
line: ascent 100.5%, descent 29.5%, line gap 0%, and a `size-adjust` from the x-height ratio
against each fallback (102.20% and 100.19%).

## Motion

Named durations, five easings and a press scale, declared in
`packages/ui/src/tokens/motion.css`, and every animation is reporting a state change.

- **Arrivals land, they do not bounce.** `--lupin-ease-arrive` is a quartic ease-out sampled
  into a CSS `linear()` easing: it decelerates and stops on its target without passing it. An
  arrival is 150ms and rises 4px, an anchored panel opens from 97%, and a list staggers 16ms a
  row up to the eighth. A `linear()` easing is interpolated by the browser like a
  cubic-bezier, so it costs nothing per frame on the main thread. Exits accelerate away on
  `ease-in`. `motion.test.ts` fails on an overshooting easing, a percentage rise or an arrival
  slower than 150ms.
- **Navigation is a view transition.** The router runs every route change through
  `document.startViewTransition`. The page crossfades with no movement, and a run's label in
  the list and its heading on the detail page share one `view-transition-name`, so opening a
  run carries the eye.
- **Only compositor properties move**: opacity and transform. A test fails on an animated
  height, width, offset or box metric.
- **Optimistic, not pending.** Adding a test to quarantine puts it in the list at once,
  marked "Saving…"; a refusal takes it out again and reopens the form with the text kept.
- **Three roles for a list arriving, a selection moving and a number changing.**
  `stagger-in` delays each row by its index, capped at the eighth so row thirty does not wait.
  `indicator` slides the accent mark under the active tab or segment with `translate` and
  `scale`. `count-up` counts a whole number to its value with a registered CSS `<integer>`;
  the real number is rendered once for assistive technology and the animated copy is hidden.
  A test fails if any of the three uses a literal time or a layout property.

Every duration is `calc(<value> * var(--lupin-motion-scale))`. Under
`prefers-reduced-motion`, or the product's own **Reduce motion** setting
(`data-motion="reduced"`), the scale collapses, the literal `duration-*` utilities are
clamped to `0.01ms`, and so are the view-transition pseudo-elements — which the universal
selector never reaches. `0.01ms` rather than `0s`, because a zero duration can suppress the
`animationend` a component waits on.

## No page scrolls, from `lg` up

From 1024px wide the page is exactly the viewport. The shell is `h-dvh` with `overflow-hidden`;
a screen is composed to fit, and anything that can grow scrolls **inside its own component**.
There are three ways to do that, in order of preference:

1. **Page the list** to the height the panel has (`useFitCount`, `usePager`).
2. **Put the long body in `PageBody`**, which keeps the page header fixed and scrolls the rest.
3. **Name a panel's body as a scroll region** with `<Panel scrollLabel="…">` for a chart or a
   table that is taller than its cell.

A scroll region is focusable and named, so a keyboard can read it. Below `lg` the panels stack
and `<main>` is the one scroll container, because reflow at narrow widths (WCAG 1.4.10) matters
more than the rule. `tests/e2e/layout/no-scroll.spec.ts` measures every route at 1280, 1440 and
1920 wide and fails on a page that scrolls; `pnpm exec playwright test --project=layout-fit` runs
it, and `UI_AUDIT_SHOTS=1` also writes a screenshot of each route.

The shell frame is `relative` on purpose. Screen-reader-only text is `position: absolute` and is
clipped only by the frame that contains it; without `relative` it stretched the document past the
viewport while every visible thing fit.

## The theme is chosen before the first paint

`apps/web/index.html` carries a small inline script that sets `data-theme` from the stored
choice, or from the system, before the stylesheet is applied. `ThemeProvider` still owns the
setting afterwards. Without the script a reader who saved the light theme saw the dark default
for a frame and then every element transitioned to light. `theme-boot.test.ts` runs the script
as it appears in the file.

## One translucent material, for what floats

The plane is flat. What is admitted is one material, `surface-translucent`, for the layers
that float over it: the command palette, dialogs, popovers, menus and toasts. It is the only place
a `backdrop-filter` is written — `theme.test.ts` fails on one anywhere else in the
stylesheet, ESLint refuses a `backdrop-*` utility class, and `theme-resolution.test.ts`
limits the material to those five components.

- **Opaque first.** The first declaration is the raised plane step; the 90% tint and the
  16px blur are inside `@supports (backdrop-filter: …)`, so no browser shows a see-through
  panel with nothing blurring what is behind it.
- **Legible whatever is behind it.** Every text token clears 4.5:1 on the tint composited
  over pure black _and_ pure white — the extremes any real backdrop lies between.
- **Never behind evidence.** Tables, charts and figures are never inside a translucent layer.
  A closed dialog is opaque until it opens (`open:surface-translucent`), so the four primary
  routes composite nothing at rest, and the render budget's `glassStackDepth` of 0 on each
  of them is measured in a real browser.
- **Off when asked.** Reduced transparency, more contrast and forced colours each return the
  opaque step with no filter.

There is also one gradient: `--lupin-gradient-ambient`, a faint violet light from the top of
the page drawn from the accent, used on entry screens only — today, the first-run screen.

## The Overview and the Map

**Four sections, and every old page is a tab.** Overview, Runs, Insights and Map are the
only top-level destinations (`apps/web/src/route-manifest.ts`, `SECTIONS`). The console is a
desktop product. Its chrome is a 64px icon rail on the start edge, one 44px icon per section with the name as a tooltip and as screen-reader text, the theme at its foot, and a tab row above the page for the section's pages. There is no top bar and no bottom bar. **The wheel snaps between categories:** each category is one screen, and one wheel step at the edge of it moves to the next or previous category in rail order, crossfaded like a click. A list or table scrolls first and the step waits for its end; a text field never moves the screen; one trackpad flick moves once (`apps/web/src/hooks/useSectionWheel.ts`).

**The Overview answers in order and stops.** The verdict first — Go, Caution or No-go, in
words and an icon as well as a colour — then _What's wrong_ beside _What's good_, each
finding with its evidence and one next action. An unknown input is listed as wrong, never
as good.

**The Map is the repository as an explorable picture**: _Flow_ from the code through the
test layers, the tools and the reports to the verdict, and _Packages_ from the repository to
each package and its evidence. The view, the open node and the path live in the URL.

## The escape hatches

| Query                                  | What it does                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `prefers-reduced-transparency: reduce` | Both borders are pushed to 3:1 against every plane step, and the translucent material turns opaque            |
| `prefers-contrast: more`               | Muted text moves toward the full foreground; both borders go to the control border; the material turns opaque |
| `forced-colors: active`                | The borders and the plane are handed to `Canvas`/`CanvasText`; the material turns opaque                      |

The status hues and the accent are left alone in the contrast query: they already clear
4.5:1, and pushing them further would put `--lupin-on-fill` below it. `forced-color-adjust`
is not set to `none` anywhere, and there is an assertion for that.

## What this site is made of

`site/.vitepress/theme/custom.css` imports `packages/ui/src/tokens/theme.css`, `fonts.css`
and `motion.css`; it does not copy them. `lupin.css` adds the site's layout — the hero, the
sections, the footer — and maps its own names (`--site-*`) onto the product's tokens. `pnpm
site:doctor` check 8 reads **every** stylesheet in the site theme and fails on a literal
colour in any of them, hex or colour function, so the site and the console cannot drift
into two palettes. The site defaults to light on a first visit; the console follows the
system setting.
