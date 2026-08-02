# CLAUDE.md — Cashkey Fork

Persistent project context. Read this first in every session.

---

## What this project is

Cashkey visualizes annual cash flow as a Sankey diagram. Income sources flow
into a central budget node, which flows out to expense categories, with a
surplus or deficit node balancing the graph.

This repository is **`lenrob/cashkey`**, a fork of `ginatrapani/cashkey`
(MIT licensed). The `upstream` remote points at the original. The `LICENSE`
file is retained and attribution appears in `README.md`.

The fork is diverging deliberately — it is becoming a distinct product, not a
patch set intended for upstream.

---

## Stack

| Layer         | Choice                                            |
| ------------- | ------------------------------------------------- |
| Framework     | React 18.3.1                                      |
| Language      | TypeScript                                        |
| Build         | Vite 5.4.21                                       |
| Styling       | Tailwind CSS 3.4.17                               |
| Components    | shadcn/ui                                         |
| Visualization | d3-sankey                                         |
| Persistence   | URL query string, plus localStorage (being added) |
| Testing       | Vitest 3.2 — node environment, no DOM library     |
| Deployment    | Local only for now                                |

Path alias `@/` maps to `./src/` — configured in both `tsconfig.app.json`
(`paths`, no `baseUrl`) and `vite.config.ts` (`resolve.alias`).

---

## Architecture

### URL-as-database

The app's defining characteristic. State serializes to JSON, is URL-encoded,
and lives in the `?data=` query parameter. There is no server and no database.
Sharing a budget means sharing a URL.

**This must continue to work.** It is the app's signature feature. localStorage
is being added for the saved-budget library, but URL sharing is not being
replaced.

The two lists below were previously one list, which is how an inverted claim
about encoding survived unnoticed. Keep them apart: the first describes what
the code does, the second describes what we require of it.

#### How it works today

Verified by `src/utils/urlUtils.test.ts` (PR 0.2).

- **The app writes two layers of percent-encoding.** `encodeState`
  percent-encodes the JSON, then `URLSearchParams.set` encodes the resulting
  `%` signs again. What lands in the address bar is `%257B`, not `%7B`
- Reading reverses both: `searchParams.get` peels one layer, `decodeState`
  peels the second
- **This is correct. Do not "fix" it.** Two layers on, two layers off, and it
  round-trips clean. Collapsing to a single layer would break every link ever
  shared — which is every link, since this is how the app has always written
  them
- Writes go through `history.replaceState`
- The 2,971-character fixture in `src/utils/urlUtils.fixtures.ts` is a real
  share link and is the regression anchor for all of the above

An earlier version of this section had it backwards, describing links as
_arriving_ with `%257B` "where the app wrote `%7B`". Nothing strips or adds a
layer in transit; the app writes both layers itself.

#### Invariants to maintain

- `history.replaceState`, never `pushState` — otherwise every keystroke
  becomes a back-button entry
- **Never trust the URL.** Malformed input must not crash the app, and must
  not silently discard a budget either. Failing to parse is not the same as
  finding no data, and the two must not share a code path
- Multiple encoding layers must be detected and unwrapped rather than assumed
  (R-PER-1)
- The PR 0.2 fixtures must keep loading through every schema migration
- **Not yet implemented:** debouncing URL writes. See the deferred-debt table

### Single page

There is no router. `react-router-dom` was removed deliberately (see history
below). `App.tsx` renders `Index` directly. Do not reintroduce a router without
discussion.

### Testing

Vitest, configured in `vite.config.ts` rather than a separate
`vitest.config.ts` — one file means the `@/` alias cannot drift between the
build and the test run.

- Tests are colocated: `src/utils/urlUtils.test.ts` beside
  `src/utils/urlUtils.ts`. `include` is `src/**/*.test.ts`
- `environment: "node"`. **No jsdom, no happy-dom.** R-QA-1 covers pure logic
  only, so nothing renders components. Node already provides `URL` and
  `URLSearchParams`; the handful of functions touching `window.location` or
  `window.history` get a `vi.stubGlobal` per test. Note that jsdom would not
  help with the R-CMP-1 quota tests either — it does not enforce a
  `localStorage` quota, so that failure mode needs a hand-written fake
  regardless
- `globals: false`. Import `describe`, `it`, `expect` from `vitest`
  explicitly. This keeps `types: ["vitest/globals"]` out of
  `tsconfig.app.json` and keeps the linter honest
- Pinned to Vitest 3.2.x. Vitest 4 requires Vite 6 or later — see the
  Vite 5 → 6 row under deferred debt

---

## Working conventions

These are non-negotiable and predate this document.

- **Plan first.** Agree the approach before writing code. State the plan,
  get confirmation, then implement.
- **Feature branches.** Work happens on branches off `main`. `main` stays green.
- **Four gates.** Before any merge, all four must pass:
  ```
  npm run lint
  npm run build
  npm run test
  npm run dev
  ```
- **Concrete over prose.** Step-by-step instructions with exact commands and
  exact file edits. Not explanatory essays.
- **One concern per PR.** Do not bundle unrelated changes.

---

## Repository history worth knowing

A dependency audit remediation was completed before feature work began. The
production dependency tree is clean (`npm audit --omit=dev` → 0
vulnerabilities). Removed during that work:

| Package                             | Why                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `next-themes@0.2.1`                 | Transitively pulled in all of Next.js and sharp — source of a critical advisory. App has no dark mode; not replaced. |
| `uuid` / `@types/uuid`              | Replaced with native `crypto.randomUUID()`. `@types/uuid` was left orphaned and removed later, in PR 0.0.            |
| `react-router-dom` / `react-router` | App is single-page. Patched version required React 19; router removed instead. `NotFound.tsx` deleted.               |

`baseUrl` was removed from `tsconfig.app.json` (deprecated in TS 6, removed in
TS 7). `paths` resolves relative to the tsconfig file without it.

### Diagnostic technique that worked

When `npm audit` produces an unreadable wall of advisories, `npm ls <package>`
identifies the actual owner. Most of the 23 original findings traced back to a
single stale scaffold dependency.

---

## Known technical debt (deliberately deferred)

| Item            | Notes                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| ESLint 8.57.1   | End of life. The config is already flat and passing as of PR 0.0; what remains is the version upgrade to 9/10.  |
| Quarantined `any` | PR 0.0 scoped `no-explicit-any` off for `SankeyDiagram.tsx` and `src/components/sankey/**` — 26 sites, all d3-sankey layout objects. The rule stays an error everywhere else. **The exemption covers existing code only, not new work.** New functions and components in those files must be typed — PR 1.5 adds a fourth Sankey column, so this lands during the phase where typing matters most. Where d3-sankey's types genuinely fight back, use a line-level `eslint-disable-next-line` rather than leaning on the file-level exemption. |
| Tailwind v3     | v4 would clear the `sucrase → glob → minimatch → brace-expansion` dev advisory chain. Config migration.        |
| Vite 5 → 6      | Two drivers converging on one branch. **Tooling:** Vitest 4 peers on Vite `^6 \|\| ^7 \|\| ^8`, so Vite 5 forces Vitest to stay on 3.2.x. **Security:** the esbuild dev advisory (GHSA-67mh-4wv8-2f99 — esbuild `<=0.24.2` via Vite `<=6.4.2`) clears on the upgrade. Dev tree only; `npm audit --omit=dev` is 0 either way. |
| Partial `strict`  | `tsconfig.app.json` sets `strict: true`, but `noImplicitAny: false` there and `strictNullChecks: false` in the root config defeat most of it. Any _new_ file should be written fully strict-clean regardless. |
| Undebounced URL writes | `Index.tsx` calls `updateUrlWithState` from a `useEffect` on every change to `incomes` or `expenses` — a `replaceState` per keystroke, with no debounce anywhere. This document previously claimed a ~300ms debounce existed; it never did. **Phase 1 watch item:** measure it when PR 1.5 lands subcategories, since the payload and the re-render cost both grow. Fix if it degrades, not before. |
| Bundle size     | 484 kB single chunk. Not urgent.                                                                               |
| React 18        | Noted in case a dependency forces React 19 later.                                                              |

---

## Gotchas

**Stale Vite cache produces phantom bugs.** A rendering fault was once bisected
to a commit that touched only README prose — the real cause was a cached module
graph. When behavior contradicts the source:

```
# stop the dev server
rd /s /q node_modules\.vite
npm run dev
# then hard-reload the browser (Ctrl+Shift+R)
```

**The dev environment is Windows.** Paths use backslashes; `rd /s /q` not
`rm -rf`. Primary workstation runs Windows 11 with VS Code and GitHub Desktop.

**Editor noise is not build failure.** The "Microsoft Edge Tools" / webhint
extension emits opinions about `tsconfig.json` that `tsc` does not share.
Verify against `npm run build`, not against squiggles.

---

## Product decisions already locked

Do not revisit these without asking:

- Comparison is **two budgets at a time**, via a **toggle** on a single
  diagram — not side by side
- Saved budgets persist in **localStorage**
- Privacy copy reads **"Your data never leaves your device"**
- Subcategories are **expand-on-demand**, not always-visible
- View state (expansion, sort order) is **never** written to URL or localStorage
- No image export, no print stylesheet, no dark mode
- Accessibility: semantic labels, focus rings, and contrast are in scope.
  A screen-reader data table for the Sankey is **not**.
- Mobile stays functional but unpolished — a priority statement, not a
  breakpoint feature

---

## Companion documents

- `docs/requirements/REQUIREMENTS.md` — numbered, testable acceptance criteria
- `docs/requirements/IMPLEMENTATION-PLAN.md` — phased PR sequence
- `docs/requirements/REQUIREMENTS-SESSION.md` — interview transcript and history
