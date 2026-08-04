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

## Phase 0 — Foundation (complete)

**Status: merged (PRs 0.0–0.3).** This section now describes what was
actually built, not what was planned — the original PR 0.2 scope
("characterize existing behavior") undersold the result, and PR 1.1 below is
scoped against the real thing, not the original description.

### PR 0.1 — Vitest setup
**Requirements:** R-QA-1 (infrastructure only)

- Vitest configured in `vite.config.ts` (not a separate config file), node
  environment, `globals: false`
- `npm run test` and `npm run test:watch`
- **Extended the three gates to four:** lint, build, test, dev

### PR 0.2 — URL decode/validation pipeline
**Requirements:** R-QA-1, R-PER-1

Went well beyond characterization. The read path was rewritten, not just
tested, and the result is the foundation PR 1.1 builds on:

- `getStateFromUrl` / `decodeState` return a `BudgetLoadResult` discriminated
  union (`src/utils/urlUtils.ts`): `{status:'absent'}`,
  `{status:'invalid', reason: LoadFailureReason}`, or `{status:'loaded', state,
  source, savedAs, issues}`. `LoadFailureReason` is a union of one member
  today (`'unreadable'`) — deliberately left open for PR 1.1 to extend
- `BudgetSource` (`'url' | 'storage' | 'sample'`) and `savedAs` are already
  modeled on the type even though `'storage'` has no producer until PR 2.1 and
  `savedAs` is always `null` until then
- Multi-layer percent-encoding is unwrapped by parsing first and only
  decoding on failure (`parseEncodedLayers`), up to `MAX_ENCODING_LAYERS`,
  rather than assuming a fixed number of layers
- **Item-level validation exists and ships today**, independent of any
  schema version: `validateItem`/`validateItems` coerce what's unambiguous
  (numeric strings, missing id/name), drop what can't be drawn (no usable
  amount), and drop negative amounts as a distinct case — all counted in a
  `LoadIssues` struct (`repaired`, `droppedMalformed`, `droppedNegative`) and
  surfaced to the user via `describeLoadIssues` and a toast in `Index.tsx`
- 69 tests, including the 2,971-character real-world share link as a fixture
  (`src/utils/urlUtils.fixtures.ts`) — this fixture has no version field and
  is therefore also the permanent v1/no-version regression case for PR 1.1
- Three defects were found and intentionally left unfixed pending PR 1.1
  (Q4, Q6, Q7 — see PR 1.1 below)

**What this means for PR 1.1:** the validation layer is not future work, it's
merged. PR 1.1 is not "build the mechanism for judging whether a payload is
usable" — that exists. Its job is to (a) add a version envelope and a
migration step that runs *before* that existing validation, and (b) close
the three deferred defects.

---

## Phase 1 — Data model

### PR 1.1 — Schema versioning and migration pipeline
**Requirements:** R-DM-1, R-DM-2 (migration support)

The validation layer (item-level coercion, drop-and-count, `BudgetLoadResult`)
already exists — see Phase 0 above. PR 1.1 does **not** rebuild that. Its job
is to insert a migration step ahead of it, so PR 1.2 and 1.3 have a pipeline to
plug into, and to close the three defects carried over from PR 0.2.

**Pipeline shape (decision, locked in):**

- **Migration runs before validation, on the raw parsed record** — not
  after, not interleaved. Rationale: migration's job is to get an old payload
  into current shape; validation's job is to judge whether current-shape data
  is usable. A v1 item with no `frequency` field is *old*, not malformed, and
  `validateItem` must not have to tell the difference. Concretely, in
  `decodeState`: `parse → migrate(record) → validateItems(migrated.incomes,
  ...)`, replacing the current direct `parse → validateItems(record.incomes,
  ...)`
- A migration step may read and transform **the whole record** (PR 1.3's
  frequency inference needs the record's global mode to backfill each item)
  or **a single raw item** (PR 1.2's per-item emoji extraction). The pipeline
  must support both shapes — e.g. a per-version migration function
  `(record) => record` that internally maps over `record.incomes` /
  `record.expenses` as needed, chained v1→v2→v3→...→current
- **`version` lives top-level on the serialized envelope, not per-item.**
  `encodeState` is changed to stamp the current schema version on every
  write (it currently writes no version at all). `decodeState` treats a
  missing `version` as v1 (legacy — every link ever shared)
- **Unknown/future version is an explicit failure, not a silent misread.**
  A `version` newer than the pipeline knows how to migrate must return
  `{status: 'invalid', reason: 'unreadable'}` rather than being run through
  validation as-is (which could misinterpret a shape it's never seen). This
  is new handling — nothing in Phase 0 covers it, since no version field
  exists yet
- **Migrated items get their own counter, separate from `repaired`.** Add
  `migrated: number` to `LoadIssues` alongside `repaired`,
  `droppedMalformed`, `droppedNegative`. Update `hasIssues` and
  `describeLoadIssues` to include it, with its own sentence (e.g. "N items
  were updated from an older link format"). Rationale: `repaired` means
  "your data was wrong and I fixed it"; `migrated` means "your data was fine
  for its era and I brought it forward." Reporting a migrated item as
  repaired would tell a user their intact old link is damaged, which is false

**Tests** (replaces the old "v1 payload loads correctly" bullet — that case
is already covered by the 69 existing tests and the no-version fixture):

- `encodeState` stamps the current version; round-trip through `decodeState`
  preserves it
- A payload with no `version` field is treated as v1 and migrates cleanly
  (the existing 2,971-character fixture is the anchor for this — it has no
  version field and must keep loading through every future migration)
- A payload with a `version` newer than current returns `{status: 'invalid'}`
  rather than being validated as-is
- A migration that touches per-item shape vs. one that touches record-level
  shape can both run in the same pipeline
- `migrated` count is reported separately from `repaired` in
  `describeLoadIssues`, with distinct wording

**Note:** this is the single most important PR in the plan. Every legacy
`?data=` link Lenny has ever bookmarked or shared depends on it.

**Carried over from PR 0.2.** Characterizing the current decode path surfaced
seven defects. Two data-loss bugs and the multi-layer unwrapping were fixed in
PR 0.2b. The three below were deferred to here and must not be lost:

| # | Defect | Fix (decision, locked in) |
|---|---|---|
| Q4 | A scalar JSON payload — `?data=123`, `?data=true` — decodes to an empty **but truthy** state rather than a failure. `Index.tsx` only seeds sample data when the result is falsy, so the app renders blank | Add `'not-a-budget'` to `LoadFailureReason`. In `decodeState`, when the parsed value is non-null but not a record (`isRecord` false), return `{status: 'invalid', reason: 'not-a-budget'}` instead of falling through to `record = {}` and a `'loaded'` empty state |
| Q6 | `encodeState` returns `""` when serialization fails, which `decodeState` reads as "no data in the URL" | A write failure must stay distinguishable from an empty URL — the same conflation PR 0.2b removed from the read path |
| Q7 | Decode failures report to `console.error` only | `Index.tsx` already toasts on `status === 'invalid'` (added in PR 0.2c) — extend the same toast path to cover migration failures (unknown-version and per-item migration errors), not just unreadable payloads |

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

### PR 1.5b — Manage subcategories UI
**Requirements:** R-DM-3

Not assigned a home by the original plan. `addSubcategory` (PR 1.4) throws
`SubcategoryConflictError` when adding a first child would silently
reinterpret an existing direct amount — that's the data layer's half of
"explicit, non-silent" (R-DM-3); nothing yet catches it or prompts the user.
Until this PR, `children` is only reachable via a hand-crafted URL payload:
PR 1.5 renders subcategories that nothing in the UI can create. Sequenced
immediately after 1.5, not deferred, so that gap doesn't sit open.

- Add/remove subcategory controls on an expense item, in the edit form
- Catch `SubcategoryConflictError` and prompt for `'preserve'` vs
  `'discard'` before calling `addSubcategory` again with a strategy
- Editing a subcategory's own amount/name/frequency
- Tests: conflict prompt triggers only on a first child added to an item
  with a direct amount; `'preserve'` and `'discard'` both round-trip through
  the UI to the same results `subcategoryUtils.test.ts` already covers at
  the function level

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
