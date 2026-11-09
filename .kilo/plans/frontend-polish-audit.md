# Frontend polish audit (brand refresh, Task 3)

Captured 2026-11-09 against the in-memory API with five seeded runs, 1440px, both themes.
Screenshots: `.agents/tasks/design-system-brand-refresh/screenshots/before/` (untracked).

## Cross-page findings (fix in `packages/ui` or a shared app component first)

1. **Status words shout.** `RECONNECTING`, `UNKNOWN`, `UNASSIGNED`, `FAILED` are uppercase
   while every other label is sentence case. Use sentence case everywhere; uppercase is not a
   status signal.
2. **Timestamps are long and wrap.** `11/9/2026, 6:39:40 AM GMT+2` breaks over two lines in
   narrow columns (Recent executions, run detail meta). Use one short relative/absolute
   format helper ("55 s ago", with the full time in a `title`/`<time dateTime>`).
3. **The docs (book) icon floats alone** above the page header, on its own row, at the
   top end. Move it into the `PageHeader` actions row.
4. **Raw error text reaches the reader.** The cockpit shows `not found` under "The cockpit
   could not be read." An error panel should say what is missing and one next step.
5. **Connection state is the page subtitle.** Runs shows "Live stream disconnected" where a
   subtitle describes the page. Move live state to a small `StatusDot` + word beside the title.
6. **Empty panels keep their full height.** Run detail's Test attempts / Quality gate panels
   are mostly blank. An empty panel should shrink to its one sentence + one action.
7. **Panel title to body gap is inconsistent** (Settings cards ~32px, Runs cards ~16px).
   One spacing step in `Panel`.

## Per page

- `now` (Cockpit): finding 4; attention row title "unknown failed" when a run has no name
  should fall back to the branch/commit ("main · designcafe04 failed").
- `runs`: findings 1, 2, 5. "Release readiness" says the same thing twice
  ("No release selected" + "No readiness has been evaluated").
- `run-detail`: findings 1, 2, 6. Header reads "Run detail" + a raw UUID; prefer the
  short id as the title and the full UUID as secondary mono text. Duration "—" with no word.
- `health`: not reached in this capture; audit after the primitives land.
- `settings`: finding 7 only. The page is otherwise the most consistent one.

## Order

Primitives (1, 2, 3, 6, 7) → then pages (4, 5, per-page items), one commit per page.

## Status (2026-11-09)

- 1 status words: **done** (`lib/status-word.ts`).
- 2 timestamps: **done** (`components/Timestamp.tsx`) on runs, recent executions, run detail.
- 3 docs icon: **kept as is, deliberately.** `PageGuide.tsx` documents why it takes no height:
  moving it into the header row re-adds height on a screen laid out not to scroll.
- 4 cockpit raw error: **done**.
- 5 live state as subtitle: **done** (runs).
- 6 empty panels full height: **open.** The panels fill the viewport grid by design (the
  no-scroll contract in `__root.tsx`); shrinking them needs a layout decision, not a class.
- 7 panel title gap: **open**, same reason as 6.
- run-detail title: **done** (short id, branch · commit, full id secondary).
- Found while capturing: `GET /api/v1/runs` served legacy rows oldest first (**Q-57, fixed**).
