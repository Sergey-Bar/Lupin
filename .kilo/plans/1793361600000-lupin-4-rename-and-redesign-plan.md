# Lupin 4.0.0 — the rename, and the console redesign

Status: implemented on `feat/lupin-4`, open items below. Owner: the repository owner.

## Decisions

1. **Hard rename in 4.0.0, no upgrade path.** There were no installs to migrate, so every
   identifier changed at once: packages (`@lupin/*`), binaries (`lupin`, `lupin-tui`),
   environment variables (`LUPIN_*`), cookies, storage keys, the webhook header, the MCP
   name, metrics, the token prefix (`lup_`), database objects edited in place in the applied
   migrations, compose, volume and image names, and repository URLs (`Sergey-Bar/Lupin`).
   `scripts/lib/product-name.test.mjs` refuses the old name in any case; the three exempt
   files and their reasons are listed in `RETIRED_NAME_EXEMPTIONS`.
2. **The console takes the site's identity and keeps the console's structure**: the violet
   accent, Geist, the Lupin neutrals, the site's radii and button height, the wordmark and the
   favicon, over four plane steps, the status and chart colours and dense spacing.
3. **The design rules changed and the gates stayed as strict.** The accent test is a violet
   hue band, a chroma floor, a distance from info and an APCA floor; translucency is one
   utility limited to four overlay files; `site:doctor` check 8 reads every site stylesheet.
4. **2026 trends adopted**: OKLCH tokens with APCA, Geist with per-step tracking in place of
   an optical axis, layered elevation, a `linear()` spring for arrivals, view-transition
   navigation with one shared element, optimistic quarantine adds, one translucent material
   for overlays, and one ambient gradient for entry screens.

`site/guide/design-language.md` is the written design, and `docs/CHANGELOG.md` 4.0.0 is the
release record.

## Evidence

- `pnpm verify:local` passed after every commit on the branch.
- axe (WCAG 2.2 AA tags) reported zero violations on 16 routes in both themes, run against
  the dev servers on the in-memory store with seeded demonstration runs. The before and after
  screenshots are written locally to `.shots/` (ignored by git) for sign-off.

## Open

- **The rendering budget has not been run on this branch.** `pnpm test:render` needs
  PostgreSQL (`DATABASE_URL`) and none was available on the development host. The four
  primary routes composite nothing at rest, so `glassStackDepth: 0` should hold; whether the
  font change moved LCP is unmeasured until CI or the reference install runs it.
- **`pnpm verify:release`** needs Docker for `oci:verify`; not run.
- **Screenshot sign-off by the owner** against the reference products (Linear, Vercel,
  Raycast) has not happened. Per-route redesign beyond the shared kit (radius, headings,
  labels, fields, tables, overlays, wordmark) is not done; each route still has its 3.x layout.
- **Keyboard walkthrough specs** are written: `tests/e2e/product/keyboard-walkthrough.spec.ts` covers the `g` chords, the `?` sheet, typing in a field, `j`/`k` rows and first-Tab focus on the six primary routes. It passed 32/32 locally against the in-memory API; CI runs it in Product E2E.
- **Manual, outside the repository:** rename the GitHub repository to `Sergey-Bar/Lupin`,
  re-enable GitHub Pages under the new URL, remove the old ghcr packages, and later claim the
  `@lupin` npm scope and set `NPM_TOKEN`.
