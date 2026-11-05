# OpenSSF Best Practices badge — registration crib

The [OpenSSF Best Practices](https://www.bestpractices.dev) "passing" badge is the one
piece of the Scorecard `CII-Best-Practices` check that cannot be satisfied from inside the
repository: it requires a project owner to register and answer a questionnaire under their
own identity. Everything the questionnaire asks for already exists in this tree; this file
maps each answer to its evidence so the registration is copy-paste.

## How to register

1. Go to <https://www.bestpractices.dev> and sign in with GitHub.
2. "Add a project", repository URL `https://github.com/Sergey-Bar/Lupin`.
3. Answer using the table below. Most rows are "Met" with a URL.
4. Note the numeric **project id** from the resulting URL (`/projects/<id>`).
5. In `README.md`, replace both `PROJECT_ID` tokens in the commented badge line and
   uncomment it.
6. Reopen the dismissed code-scanning alert so Scorecard re-grades it:
   `gh api -X PATCH repos/Sergey-Bar/Lupin/code-scanning/alerts/20 -f state=open`
   then let the weekly Scorecard run (or `gh workflow run scorecard.yml`) pick it up.

## Answers, with evidence

| Criterion (passing level)            | Answer | Evidence in this repo                                                                 |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------- |
| Project homepage / description       | Met    | `README.md`; homepage <https://sergey-bar.github.io/Lupin/>                           |
| Homepage served over HTTPS           | Met    | GitHub Pages + github.com are HTTPS                                                   |
| Documentation (user + a.p.i.)        | Met    | `site/` VitePress docs; `docs/openapi.json`                                           |
| Contribution guide                   | Met    | `.github/CONTRIBUTING.md`                                                             |
| Code of conduct                      | Met    | `.github/CODE_OF_CONDUCT.md`                                                          |
| OSS license, in a standard place     | Met    | `LICENSE` (MIT, SPDX `MIT`)                                                           |
| Version-controlled public repo       | Met    | <https://github.com/Sergey-Bar/Lupin>                                                 |
| Unique version numbering / releases  | Met    | Git tags + `.github/workflows/release.yml`                                            |
| Release notes / changelog            | Met    | GitHub Releases; `release-gate.yml`                                                   |
| Vulnerability report process         | Met    | `.github/SECURITY.md` — private reporting enabled on the Security tab                 |
| Vulnerability report private channel | Met    | GitHub private vulnerability reporting is enabled                                     |
| Build from source                    | Met    | `pnpm install && pnpm build` (documented in `AGENTS.md` / `site/guide/install.md`)    |
| Automated test suite                 | Met    | `pnpm test` (Vitest) across every package; CI job "Unit and coverage"                 |
| Tests added with new features        | Met    | `.github/CONTRIBUTING.md` three-commit rule; coverage ratchet enforces it             |
| New-functionality testing policy     | Met    | `.github/CONTRIBUTING.md` + `docs/quality/coverage-baseline.json`                     |
| Warnings as errors / linting         | Met    | `pnpm lint` (ESLint, `--max-warnings=0`); `pnpm typecheck`                            |
| Static analysis                      | Met    | `pnpm security:static` (semgrep + gitleaks) in the CI `security` job; CodeQL workflow |
| Secured delivery (signed/HTTPS)      | Met    | SHA-pinned GitHub Actions; npm publish via `npm-publish.yml`; OCI image provenance    |
| Dependencies monitored for vulns     | Met    | Dependabot (`.github/dependabot.yml`); `pnpm audit` in `security:verify`              |
| Crypto practices (if applicable)     | Met    | Vault uses AES-256-GCM + PBKDF2 (`apps/api/src/infrastructure/vault-crypto.ts`)       |

## Why no badge is committed yet

A badge image URL is `https://www.bestpractices.dev/projects/<id>/badge`. With no `<id>`
the image is a 404 and the link is dead, which misrepresents the project's status — worse
than no badge. The markup is therefore held, commented, in `README.md` beside the other
badges, to be turned on in the one commit that also records the real id here.
