# Cashkey Fork — Implementation Plan

**Version:** 1.0
**Date:** 2026-08-02
**Companion to:** `REQUIREMENTS.md`

---

## Sequencing rationale

Three requirements — per-item frequency (R-DM-1), emoji split (R-DM-2), and
subcategories (R-DM-3) — each change the data model and therefore the URL
schema. The comparison feature (R-CMP-*) reads that model throughout its delta
and union logic.

**Data model changes land first.** Building comparison against a schema that is
about to change three more times means rebuilding it three times. This was an
explicit product owner decision, made with the tradeoff understood: the
headline feature arrives later, but arrives once.

Within the data model phase, changes are ordered least to most invasive so each
lands on a stable base.

---

## Phase 0 — Foundation

Test infrastructure has to exist before the migration work, because migration
correctness is exactly what needs proving.

### PR 0.1 — Vitest setup
**Requirements:** R-QA-1 (infrastructure only)

- Add Vitest and configure for the Vite project
- Add `npm run test` and `npm run test:watch`
- One trivial passing test to prove the harness
- **Extend the three gates to four:** lint, build, test, dev

### PR 0.2 — Characterize existing behavior
**Requirements:** R-QA-1, R-PER-1

Write tests against the URL serialization **as it works today**, before
changing it. These are the safety net for every subsequent migration.

- Round-trip serialize/deserialize of a representative budget
- Malformed input rejected without crashing
- Double-encoded input (`%257B`) detected and unwrapped
- The long real-world URL from the requirements session as a fixture

---

## Phase 1 — Data model

### PR 1.1 — Schema versioning
**Requirements:** R-DM-1, R-DM-2 (migration support)

Before changing the shape, add the mechanism for changing the shape.

- Introduce a version field in the serialized payload
- Payloads with no version are treated as v1 (legacy)
- A migration pipeline runs on load, upgrading old payloads in memory
- Tests: a v1 payload loads correctly through the pipeline

**Note:** this is the single most important PR in the plan. Every legacy
`?data=` link Lenny has ever bookmarked or shared depends on it.

### PR 1.2 — Emoji as separate field
**Requirements:** R-DM-2

- Add `emoji` to the item model; bump schema version
- v1→v2 migration extracts a leading emoji from the name where detectable,
  leaves the name intact where not
- Emoji picker in the add/edit UI
- Display concatenates emoji and name — no visual change
- Tests: migration cases including no emoji, leading emoji, emoji mid-string,
  multi-codepoint emoji (e.g. 🏝️ with variation selector, as used in the
  sample data)

### PR 1.3 — Per-item frequency
**Requirements:** R-DM-1

- Add `frequency` to the item model; store amounts normalized to annual
- Migration: items without frequency inherit the payload's global mode
- Frequency selector per item in the edit UI
- Global toggle becomes display-only — verify it no longer mutates data
- Tests: normalization math, mixed-frequency budgets, migration from v2

### PR 1.4 — Subcategory data model
**Requirements:** R-DM-3

Data model only. No chart changes in this PR.

- Expenses may contain one level of children
- Parent amount is derived from children when children exist
- Explicit, non-silent handling when subcategories are added to a category
  that held a direct amount
- Income remains flat
- Tests: rollup math, add/remove child, parent-total invariants

### PR 1.5 — Subcategory rendering
**Requirements:** R-DM-3, R-DM-4, R-DM-5

- Fourth Sankey column for expanded categories only
- Expand/collapse affordance, shown only where children exist
- Multiple simultaneous expansions
- Expansion state held in component state — never serialized (R-DM-5)

---

## Phase 2 — Persistence

### PR 2.1 — localStorage layer
**Requirements:** R-CMP-1, R-QA-1

Storage module only; no comparison UI yet.

- Save, load, list, rename, delete
- Explicit handling of quota exceeded and storage-unavailable
- Tests including both failure modes

### PR 2.2 — Saved budget library UI
**Requirements:** R-CMP-1, R-IN-1

- List of saved budgets with rename and delete
- Save and Save-as
- Duplicate a budget (R-IN-1)

### PR 2.3 — Shared URL behavior
**Requirements:** R-PER-2, R-PER-3

- A URL-loaded budget is unsaved scratch
- Prompt before discarding unsaved work when opening a shared link
- Never silently create or overwrite a saved budget
- Privacy copy updated to "Your data never leaves your device" in UI and
  `README.md`

---

## Phase 3 — Comparison

The headline feature. Everything it depends on is now stable.

### PR 3.1 — A/B slots and toggle
**Requirements:** R-CMP-2, R-CMP-3

- Select A and B from the library
- Comparison mode available only when both are filled
- Instant-redraw toggle, current slot clearly labeled
- Exiting returns to single-budget editing

### PR 3.2 — Category union and node stability
**Requirements:** R-CMP-6, R-DM-2

- Union of categories across A and B
- Matching on name only — case-insensitive, trimmed
- Stable row order; absent categories render as greyed zero stubs
- Tests: union logic, matching rule, emoji-differs-name-matches case

### PR 3.3 — Shared axis scaling
**Requirements:** R-CMP-5

- Shared scale derived from the larger total, as default
- Independent-scale toggle
- Scaling mode is view state

### PR 3.4 — Delta figures
**Requirements:** R-CMP-4, R-OUT-1

- Per-category A value, B value, absolute delta, percentage delta
- Totals deltas for income, expenses, surplus/deficit
- Expense-to-income ratio delta in percentage points
- Tests: delta math including divide-by-zero and one-sided categories

---

## Phase 4 — Input and polish

Independent of the phases above; could move earlier if the data model work
stalls.

### PR 4.1 — Category presets
**Requirements:** R-IN-4

### PR 4.2 — Sort and reorder
**Requirements:** R-IN-5

### PR 4.3 — Undo on delete
**Requirements:** R-IN-6

### PR 4.4 — Paste-to-parse
**Requirements:** R-IN-2

- Preview before commit; unparseable lines reported, never dropped silently

### PR 4.5 — CSV import
**Requirements:** R-IN-3

- Preview before commit; malformed rows reported with row numbers

### PR 4.6 — Expense-to-income ratio
**Requirements:** R-OUT-1

Single-budget display. The comparison delta ships in PR 3.4; if Phase 4 runs
first, that PR consumes this one's output.

### PR 4.7 — Accessibility floor
**Requirements:** R-QA-2

- Semantic labels, focus indicators, contrast, keyboard operability
- Best done as a sweep once the UI has settled

---

## Definition of done

Every PR must pass, before merge:

```
npm run lint
npm run build
npm run test
npm run dev
```

Plus, for any PR touching serialization or the data model:

- The Phase 0.2 legacy URL fixtures still load correctly
- The original long `?data=` link from the requirements session still renders

---

## Risks

| Risk | Mitigation |
|---|---|
| Legacy URL breakage | PR 1.1 versioning and PR 0.2 fixtures exist specifically for this. Do not skip them. |
| Subcategory visual crowding | R-DM-4 expand-on-demand is the mitigation. If a fourth column still reads badly at 11+ categories, raise it rather than shipping something unreadable. |
| localStorage quota | R-CMP-1 requires explicit failure handling. Budgets are small, but a large library of them is not free. |
| Scope creep into Ctrl+Z | R-IN-6 scopes undo to deletes only. Resist expansion. |
| Emoji matching edge cases | Multi-codepoint emoji with variation selectors appear in the real sample data. Test them specifically. |

---

## Deferred

Not in this plan. Raise separately when the feature work is stable.

- ESLint 9/10 flat config migration
- Tailwind v4 upgrade
- `strict: true`
- Bundle splitting
- Deployment beyond local
- JSON export/import (R-FUT-1) — keep the model export-friendly, but do not
  build it yet
