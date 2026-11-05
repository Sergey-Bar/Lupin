# Flat refinement and calm motion (product + docs site)

Branch `feat/design-system-brand-refresh`. Refine only: the tokens, palette, the Lupin violet,
fonts and radii are unchanged, and `surface-translucent` stays on the overlays.

## The rubric

Each item names the vendored skill it comes from and the check that decides it. "Gate" means a
test fails if the rule breaks; "eye" means it is scored from the screenshots.

| #   | Rule                                                                         | Source skill                                 | Decided by                                                         |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| R1  | No easing overshoots; arrivals decelerate and land                           | review-animations, animation-vocabulary      | Gate: `packages/ui/src/tokens/motion.test.ts` "the arrival easing" |
| R2  | Arrivals ≤150ms, rise a fixed ≤6px, zoom from ≥97%, stagger worst case ≤128ms | review-animations                            | Gate: `motion.test.ts` "calm motion"                               |
| R3  | A route change is a crossfade with no movement                               | review-animations                            | Gate: `motion.test.ts` "calm motion"                               |
| R4  | Only compositor properties animate                                           | fixing-motion-performance                    | Gate: `motion.vocabulary.test.ts`; the site progress bar now scales |
| R5  | Every duration is a token the reduced-motion scale reaches, scaled once      | fixing-accessibility, web-design-guidelines  | Gate: `motion.test.ts`; `pnpm site:doctor` check 8 for the site     |
| R6  | Shadows come only from the `shadow-elevation-*` stack; panels carry none     | beautiful-shadows, swiss-design              | Gate: `apps/web/src/motion-rubric.test.ts`                          |
| R7  | Hover and colour follow the pointer in ≤100ms                                | review-animations                            | Gate: `motion-rubric.test.ts`                                       |
| R8  | Headings balance their lines                                                 | better-typography                            | Gate: `motion-rubric.test.ts` "the base typography"                 |
| R9  | Figures in tables and readings use tabular numerals                          | better-typography                            | Gate: `motion-rubric.test.ts`; existing mono rule for code          |
| R10 | Focus visible on every control; targets ≥44px                                | better-accessibility, fixing-accessibility   | Existing gates (`Button`/`Input`/`Select` height test); eye         |
| R11 | Chrome is minimal: grouping by space before borders                          | swiss-design, web-design-guidelines          | Eye                                                                 |
| R12 | Nothing truncates the value a reader came for at the supported widths        | web-design-guidelines                        | Eye                                                                 |

## What changed

1. `fix(ui)`: each `--animate-*` duration was multiplied by the motion scale twice (0.0001×
   under reduced motion). Scaled once now.
2. `feat(ui)`: `--lupin-ease-spring` (2% overshoot) replaced by `--lupin-ease-arrive`, a quartic
   ease-out in `linear()` stops. Arrivals 150ms and 4px; zoom from 97%; stagger 16ms; route
   changes crossfade (`lupin-fade-in`). `site/guide/design-language.md` updated.
3. `fix(docs)`: six site components wrote literal durations (to 400ms) and one animated `width`.
   All now use the product tokens, and `site:doctor` check 8 fails on a literal duration or
   easing in any site stylesheet or component `<style>`.
4. `fix(ui)`: `shadow-md`/`shadow-lg` in Toast, Toggle and Tooltip moved to the elevation stack;
   inert `duration-*` beside `animate-*` removed; MasterDetail row colour 200ms → 100ms;
   `h1–h4` balanced and `td`/`th` tabular in the base layer.

## Scorecard

Screenshots: `.agents/tasks/design-system-brand-refresh/screenshots/{before,after}/` (44 each: ten
product routes plus the site home, light and dark, 1440 and 390). They are captured with
reduced motion, so R1–R5 are decided by the gates, not the images.

| Screen                     | Before          | After                              |
| -------------------------- | --------------- | ---------------------------------- |
| Motion, all surfaces       | R1, R2, R3, R5 fail | R1–R5 pass (gated)             |
| Overlays (toast, tooltip)  | R6 fail         | R6 pass                            |
| Runs list                  | R7 fail         | R7–R10 pass; R11 pass              |
| Every heading              | R8 partial      | R8 pass                            |
| Run detail, 390 wide       | R12 fail        | **R12 still fails** (see F1); R11 partial (F2) |
| Overview, Cockpit, Insights, Map, GitHub, Settings | R6–R10 pass | unchanged pass             |
| Site home                  | R4, R5 fail     | R1–R11 pass                        |

## Follow-ups (outside refine scope, not done)

- **F1.** Run detail at 390px truncates the Created/Started/Finished timestamps with an
  ellipsis. Needs a shorter date format or a one-column metadata list.
- **F2.** Run detail's phase timeline draws nine outlined chips; a single step line would carry
  the same information with less chrome.
- **F3.** Runs list at 1440: "Recent executions" truncates run ids mid-string; the id column could
  show the short id the table already uses.
