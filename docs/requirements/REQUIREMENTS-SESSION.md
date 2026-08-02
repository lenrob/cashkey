# Cashkey Fork — Requirements Gathering Session

**Repository:** https://github.com/lenrob/cashkey (fork of `ginatrapani/cashkey`)
**Local path:** `D:\Documents\Dev\cashkey`
**Session date:** 2026-08-01
**Status:** IN PROGRESS — paused after Section 1
**Participants:** Lenny Robinson (product owner), Claude (business analyst)

---

## Purpose of this document

This is a **session handoff**, not a deliverable. It captures where the
requirements interview stopped so it can resume in a new conversation without
re-covering ground.

Paste this file back into a new Claude conversation with:
`"We're resuming the cashkey requirements interview. Here's where we left off."`

---

## Engagement definition

Claude is acting as a **senior business analyst** conducting a structured
requirements interview. The output will be handed to Claude Code (acting as
senior developer) to implement.

### Agreed deliverables (not yet written)

| Document | Purpose |
|---|---|
| `CLAUDE.md` | Persistent project context Claude Code reads every session — stack, architecture, conventions, three-gate discipline |
| `REQUIREMENTS.md` | Numbered, testable acceptance criteria per change |
| `IMPLEMENTATION-PLAN.md` | Phased plan mapping requirements to PRs |

Format decision: lean documentation, not the 2,100-line SRS treatment used for
DebtReduce. Cashkey is a much smaller app.

### Fork intent

All three of the following, in sequence:
- **(a)** Targeted improvements for personal use
- **(b)** Evolve into a distinct product with different features
- **(c)** Eventually integrate into the broader personal finance ecosystem

Explicitly **out of scope**: cashkey will NOT read data from the net worth
workbook (`Officialnet_worth_V3.xlsx`) or DebtReduce. It stays standalone.
A shared JSON file format is acceptable as a future bridge, but no direct
integration.

---

## Current application state (baseline)

The app is working and committed. Before requirements work began, a dependency
audit remediation was completed:

- **0 production vulnerabilities** (`npm audit --omit=dev`), down from 23 findings including 1 critical
- Removed `next-themes@0.2.1` (was transitively pulling in all of Next.js + sharp — source of the critical)
- Removed `uuid` → replaced with native `crypto.randomUUID()`
- Removed `react-router-dom` / `react-router` → app is single-page, router deleted from `App.tsx`, `NotFound.tsx` deleted
- Removed deprecated `baseUrl` from `tsconfig.app.json`
- Build clean, bundle 484 kB (down from 520 kB), 408 packages (down from 473)

**Current stack:** React 18.3.1, TypeScript, Vite 5.4.21, Tailwind 3.4.17,
shadcn/ui, d3-sankey. URL-as-database persistence.

### Known deferred technical debt

| Item | Notes |
|---|---|
| ESLint 8.57.1 | End-of-life. Flat config migration to ESLint 9/10 is its own branch. |
| Tailwind v3 | v4 upgrade would clear the sucrase→glob→minimatch→brace-expansion dev advisory chain. |
| `strict: false` | Scaffolded code likely won't survive `strict: true`. Better addressed in a rewrite than retrofitted. |
| Bundle size | 484 kB single chunk. Not urgent. |
| React 18 | `react-router@8` required React 19 — noted in case other deps force the issue later. |

### Gotcha worth remembering

A stale Vite cache caused a phantom rendering bug mid-session (chart appeared
too wide; git bisect showed identical source). Fix: stop dev server,
`rd /s /q node_modules\.vite`, restart, hard-reload browser.

---

## SECTION 1: COMPARISON — COMPLETE

This was identified as the largest architectural decision because it breaks the
app's defining URL-as-database constraint.

### Confirmed requirements

| # | Question | Decision |
|---|---|---|
| 1.1 | What is compared? | Any of: scenarios, time periods, actual vs. planned, before/after life event — **individually**. The app does not need to distinguish these; comparison type is just the user's label. |
| 1.2 | Display method | Single diagram with a **toggle between states** (not side-by-side) |
| 1.3 | How many at once | **Two** |
| 1.4 | Persistence | **localStorage / IndexedDB** — URL-only constraint is relaxed |
| 1.6 | Budget identity | **User-supplied name** |
| 1.8 | Delta display | **Numbers alongside** the diagram (e.g. `Housing $16,608 → $14,200, −$2,408 (−14%)`) |
| 1.11 | Storage scope | **A library of saved budgets** with pick-A / pick-B, rename, and delete |

### Analyst assumptions — NEED LENNY'S REVIEW

These were deferred to the analyst. Confirm or override before implementation.

| # | Question | Assumed decision | Rationale |
|---|---|---|---|
| 1.7 | Transition style | **Instant redraw, no animation** | Simpler; delta numbers (1.8) already make the change legible |
| 1.9 | Axis scaling | **Shared scaling** (both drawn against the larger total), with an "independent scale" toggle | Makes the A/B toggle visually honest; escape hatch if cramped |
| 1.10 | Node stability | **Union of categories, stable row order.** Zero-value nodes render as a thin stub with greyed label | Keeps row positions fixed so the toggle is readable |
| 1.12 | Shared URL + local saves | **URL loads as unsaved scratch** with "Save as…" available. Never silently overwrites a saved budget | Preserves existing share-link behavior exactly |

### Consequential decisions flowing from Section 1

- **Privacy copy must change.** Current UI says "Your data is stored only in the URL." With localStorage this becomes inaccurate. Suggested replacement: *"Your data never leaves your device."* Needs Lenny's sign-off on exact wording.
- **JSON export/import format** should be designed deliberately — it is the natural bridge to a future Electron app (goal c).
- **Share-by-URL must continue to work unchanged.** This is the app's signature feature.

---

## SECTION 2: DATA MODEL AND CATEGORIES — NOT STARTED

Questions queued:

- **2.1** Subcategories? (e.g. Housing → Mortgage / Insurance / Taxes as a fourth Sankey column) Or is flat sufficient?
- **2.2** Starter set of common categories to pick from, or always type your own?
- **2.3** Emoji are currently part of the name string (`"🏡 Housing"`). Keep as-is, or separate field with a picker?
- **2.4** Additional per-line-item fields — notes, fixed/variable flag, due date, payment account?

## SECTION 3: INPUT AND EDITING — NOT STARTED

- **3.1** Bulk entry — paste a text block, or CSV import?
- **3.2** Mixed monthly/annual amounts within one budget (rent monthly, insurance annual) with app normalizing? Or is the current global toggle fine?
- **3.3** Reordering, sorting, or grouping of the lists?
- **3.4** Undo?

## SECTION 4: OUTPUT — NOT STARTED

- **4.1** Export diagram as PNG or SVG?
- **4.2** Print stylesheet?
- **4.3** Summary stats beyond surplus/deficit — savings rate, expense ratios, top-N?

## SECTIONS NOT YET SCOPED

Likely additional areas to cover once 2–4 are done:

- Accessibility (Lenny held DebtReduce to WCAG 2.1 AA — likely applies here)
- Mobile / responsive behavior
- Dark mode (note: `next-themes` was removed; re-adding needs a Vite-compatible approach)
- Testing strategy
- Deployment target (Vercel assumed, matching HomeDecide)

---

## NEXT STEPS

1. Resume interview at **Section 2.1**
2. Complete Sections 2, 3, 4
3. Scope and complete remaining sections (accessibility, mobile, dark mode, testing, deployment)
4. Lenny reviews and confirms/overrides the four analyst assumptions in Section 1
5. Lenny signs off on privacy copy wording
6. Claude produces `CLAUDE.md`, `REQUIREMENTS.md`, `IMPLEMENTATION-PLAN.md`
7. Hand off to Claude Code — feature branches, three gates (lint / build / dev) before merge

---

## Working conventions (for Claude Code handoff)

- Plan-first: agree the approach before writing code
- Feature branches off `main`; `main` stays green
- Three gates before merge: `npm run lint`, `npm run build`, `npm run dev` all pass
- `upstream` remote points at `ginatrapani/cashkey` — MIT licensed, `LICENSE` file retained, attribution in `README.md`
- Concrete step-by-step instructions preferred over explanatory prose
