# Cashkey Fork — Requirements

**Version:** 1.0
**Date:** 2026-08-02
**Status:** Approved — all open questions resolved
**Product owner:** Lenny Robinson
**Analyst:** Claude

---

## How to read this document

Requirements are numbered `R-<area>-<n>` and written as testable statements.
Each has acceptance criteria. Where a decision was made by the analyst and
confirmed by the product owner, it is marked **[Confirmed]** with the
reasoning retained.

Requirements marked **[Out of scope]** are recorded so they are not
re-proposed.

---

## 1. Data model

### R-DM-1 — Per-item frequency

Each income and expense line item stores its own entry frequency (monthly or
annual). Amounts are stored normalized to **annual** in the data model.

**Correction (post-PR-1.3):** this requirement originally said "the existing
global monthly/annual control becomes a display toggle," describing PR 1.3 as
converting something already there. There was no such control. The
pre-existing period `Select` on the add-item form was local, per-add-click
state: it converted a typed monthly figure to annual before the item was
ever constructed, then discarded the choice — nothing was stored on the
item, nothing was stored globally, and the edit form had no period control
at all. PR 1.3 **introduces** a global display toggle, built display-only
from the start, rather than converting an existing one. Below reflects what
was actually built.

A separate, new global display toggle changes the units shown in the totals
and list — the Sankey chart itself renders no dollar figures, only
unit-invariant percentages, so it needed no change. The toggle never changes
how items are entered or stored.

**Acceptance criteria**
- A line item can be entered as monthly or annual, independently of any other item
- An item entered as $1,384/month and an item entered as $16,608/year produce
  identical stored values and identical Sankey flows
- Switching the global display toggle changes displayed figures but never
  mutates stored data
- Round-tripping a budget through URL serialization preserves each item's
  entry frequency
- Normalization math is covered by unit tests (see R-QA-1)

**Migration:** existing `?data=` links have no per-item frequency. Since the
old UI's per-add period selector was never persisted (see correction above),
there is also no per-link "global mode" to read: every pre-1.3 stored amount
is already annual, because the old UI normalized to annual before storing,
unconditionally. On load, items without a frequency field are backfilled to
`'annual'` — this is an assumption made explicit in code and in the
migration-count reporting, not intent recovered from the link. This must not
crash or silently misvalue old links.

---

### R-DM-2 — Emoji as a separate field

Emoji move out of the name string into their own field. `"🏡 Housing"` becomes
`{ emoji: "🏡", name: "Housing" }`.

**Rationale [Confirmed]:** category matching between two budgets (R-CMP-4) keys
on the name portion only. If A says "🏡 Housing" and B says "🏠 Housing", they
must still be recognized as the same category.

**Acceptance criteria**
- Emoji is optional; an item with no emoji renders and functions normally
- An emoji picker is available when adding or editing an item
- Display concatenates emoji and name as it does today — no visual regression
- Category matching for comparison uses `name` only, case-insensitive,
  trimmed
- Legacy URLs with emoji embedded in the name string load without error.
  The leading emoji is extracted into the emoji field where detectable;
  where not detectable, the whole string remains the name

---

### R-DM-3 — Subcategories

An expense category may contain subcategories (e.g. Housing → Mortgage,
Insurance, Property Tax). Nesting is **one level deep only**.

A parent category's amount is the sum of its subcategories when subcategories
exist; otherwise the parent holds its own amount directly.

**Acceptance criteria**
- A category with no subcategories behaves exactly as today
- Adding a subcategory to a category that had a direct amount either
  distributes or replaces that amount — behavior must be explicit and
  documented in the UI, not silent
- Parent totals always equal the sum of their children
- Rollup math is covered by unit tests (see R-QA-1)
- Subcategories are supported for **expenses only**. Income remains flat.

---

### R-DM-4 — Subcategory display: expand on demand

The Sankey renders three columns by default. Expanding a category reveals its
subcategories as a fourth column for that category only.

**Rationale [Confirmed]:** with 11+ top-level expenses, a permanently expanded
fourth column is visually unreadable.

**Acceptance criteria**
- Categories with subcategories show an affordance indicating they can expand
- Categories without subcategories show no affordance
- Multiple categories may be expanded simultaneously
- Collapsing returns the chart to its prior layout with no visual artifacts

---

### R-DM-5 — Expansion state is view state [Confirmed]

Expansion state is **not** persisted — not to the URL, not to localStorage.

**Rationale:** expansion persists across the A/B toggle so a user can expand
Housing and flip between budgets to watch that one category change. Keeping it
out of storage prevents the URL carrying UI state and prevents a shared link
imposing the sender's expansion state on the recipient.

**Acceptance criteria**
- Expansion state survives an A/B toggle
- Expansion state resets to fully collapsed on page load
- The `?data=` parameter contains no expansion information
- A saved budget in localStorage contains no expansion information

---

### R-DM-6 — Additional per-item fields [Out of scope]

Notes, fixed/variable flags, due dates, and payment accounts were considered
and declined.

---

## 2. Saved budgets and comparison

### R-CMP-1 — Saved budget library

Budgets persist in localStorage. Each has a user-supplied name.

**Acceptance criteria**
- A budget can be saved with a name
- Saved budgets are listed
- A saved budget can be renamed
- A saved budget can be deleted
- Saved budgets survive a browser restart
- Storage failures (quota exceeded, storage disabled) surface a clear message
  rather than failing silently
- Save/load is covered by unit tests (see R-QA-1)

---

### R-CMP-2 — Slot A and slot B

Two budgets can be selected from the library into comparison slots A and B.

**Acceptance criteria**
- A and B are each selected from the saved library
- Comparison mode is available only when both slots are filled
- Either slot can be changed without disturbing the other
- Exiting comparison mode returns to normal single-budget editing

---

### R-CMP-3 — Toggle between states

In comparison mode a single Sankey diagram displays either A or B, switched by
a toggle. **Not** side by side.

**Acceptance criteria**
- The toggle switches the rendered diagram between A and B
- The currently displayed slot is clearly labeled with its budget name
- The switch is an **instant redraw with no animation** [Confirmed —
  1.7: delta numbers already convey the change; path interpolation is fiddly
  and degrades when categories exist in one budget but not the other]

---

### R-CMP-4 — Delta figures

Comparison mode displays numeric differences alongside the diagram.

**Acceptance criteria**
- Each category shows its A value, its B value, the absolute delta, and the
  percentage delta — e.g. `Housing $16,608 → $14,200, −$2,408 (−14%)`
- Categories present in only one budget are shown with the absent side as zero
- Totals show deltas for income, expenses, and surplus/deficit
- The expense-to-income ratio (R-OUT-1) shows an A→B delta
- Delta calculations are covered by unit tests (see R-QA-1)

---

### R-CMP-5 — Shared axis scaling [Confirmed]

Both budgets render against a shared scale derived from the larger total, so a
smaller budget visibly renders smaller. An "independent scale" toggle allows
each to fill the frame.

**Rationale:** shared scaling makes the A/B toggle honest — less money moving
should look like less money moving. The escape hatch exists because widely
differing totals can make the smaller budget hard to read.

**Acceptance criteria**
- Default is shared scaling
- An independent-scale toggle is available
- The scaling mode is view state, not saved data (consistent with R-DM-5)

---

### R-CMP-6 — Node stability across the toggle [Confirmed]

The diagram renders the **union** of categories across A and B, in a stable
row order. A category present in one budget and absent in the other renders in
the other as a thin zero-value stub with a greyed label.

**Rationale:** fixed row positions let the eye track a single category across
the toggle. Reflowing rows is cleaner per-state but much harder to compare.

**Acceptance criteria**
- Row order is identical between A and B
- Zero-value stubs are visually distinguishable from small real values
- Zero-value stubs do not distort the scale
- Category identity for union purposes uses the R-DM-2 matching rule

---

## 3. Input and editing

### R-IN-1 — Duplicate a budget

A saved budget can be duplicated as the starting point for a new one.

**Acceptance criteria**
- Duplicating prompts for a new name
- The duplicate is fully independent — editing it does not affect the original

---

### R-IN-2 — Paste-to-parse bulk entry

A block of pasted text can be parsed into line items.

**Acceptance criteria**
- Accepts one item per line in the form `Name Amount` (e.g. `Housing 16608`)
- Tolerates currency symbols, thousands separators, and extra whitespace
- Unparseable lines are reported to the user, not silently dropped
- A preview is shown before items are committed

---

### R-IN-3 — CSV import

Line items can be imported from a CSV file.

**Acceptance criteria**
- The expected column format is documented in the UI
- Import supports name, amount, frequency, emoji, and parent category
- Malformed rows are reported with row numbers, not silently dropped
- A preview is shown before items are committed
- The CSV column format matches the JSON export shape where practical, so the
  two formats stay conceptually aligned (see note under R-FUT-1)

---

### R-IN-4 — Category presets

A picker offers common categories when adding an item, with free text always
available.

**Acceptance criteria**
- A preset list of common income and expense categories is offered
- Presets include an emoji and a name
- The user can always type a custom name instead
- Choosing a preset does not prevent subsequent editing

---

### R-IN-5 — Sort and reorder [Confirmed]

Each list has a sort control: **amount descending (default)**, alphabetical, or
manual. In manual mode, items can be dragged to reorder.

**Rationale:** amount-descending matches the Sankey's own visual ordering,
which is what a user expects when scanning between chart and list.

**Acceptance criteria**
- Sort preference is view state, not saved data (consistent with R-DM-5)
- Drag handles appear only in manual mode
- Manual order persists within the session

---

### R-IN-6 — Undo on delete [Confirmed]

Deleting a line item removes it immediately and shows an undo toast for
approximately 8 seconds. No confirmation dialog.

**Rationale:** confirmation dialogs on every delete become tedious with 16+
line items. Undo is lower friction and more forgiving.

**Scope note:** undo covers **deletes only**. General Ctrl+Z across all edit
operations is deliberately not in this release.

**Acceptance criteria**
- Delete is immediate
- An undo affordance appears and restores the item, including its position
- The toast dismisses on timeout without side effects

---

## 4. Output

### R-OUT-1 — Expense-to-income ratio [Confirmed]

Display total expenses as a percentage of total income.

**Rationale:** total-level only. Per-category ratios would duplicate the
percentage labels the Sankey already renders.

**Acceptance criteria**
- The ratio is displayed alongside the existing surplus/deficit figure
- In comparison mode the ratio shows an A→B delta in percentage points

---

### R-OUT-2 — Image export [Out of scope]
### R-OUT-3 — Print stylesheet [Out of scope]

---

## 5. Persistence and privacy

### R-PER-1 — URL sharing preserved

URL-based sharing continues to work unchanged. It remains the mechanism for
sharing a budget with another person.

**Acceptance criteria**
- A budget serializes to a shareable URL
- A shared URL loads correctly in a browser with no saved budgets
- Malformed or hostile URL content is rejected without crashing
- Double-encoded URLs (`%257B` where `%7B` was written) are detected and
  unwrapped
- Round-trip serialization is covered by unit tests (see R-QA-1)

---

### R-PER-2 — Opening a shared URL [Confirmed]

A budget arriving via URL loads as **unsaved scratch**. It does not enter the
saved library until the user explicitly saves it.

**Acceptance criteria**
- An opened URL renders immediately without requiring a save
- A "Save as…" affordance is available
- No saved budget is ever silently created or overwritten
- **If the user has unsaved work in progress, opening a shared URL prompts
  before discarding it** [Confirmed]

---

### R-PER-3 — Privacy copy [Confirmed]

The UI text "Your data is stored only in the URL" is replaced with
**"Your data never leaves your device."**

**Rationale:** the original wording becomes false once budgets persist in
localStorage. The replacement remains accurate and preserves the app's
privacy proposition.

**Acceptance criteria**
- No remaining UI text claims data is stored only in the URL
- `README.md` is updated to match

---

## 6. Quality

### R-QA-1 — Unit tests on core logic [Confirmed]

Vitest covering the logic where a silent bug would corrupt real budget figures:

- URL serialize/deserialize round-trip, including malformed and
  double-encoded input
- Monthly ↔ annual normalization (R-DM-1)
- Subcategory rollup math (R-DM-3)
- A/B delta calculations (R-CMP-4)
- localStorage save/load, including quota and unavailability failure modes
- Legacy data migration (R-DM-1, R-DM-2)

**Explicitly not covered:** component rendering, UI interaction, visual
regression.

**Rationale:** this software will be trusted with real personal budget
figures. Math errors are silent; UI errors are obvious on sight.

---

### R-QA-2 — Accessibility floor [Confirmed]

Full WCAG 2.1 AA conformance is **not** required. The following are in scope
because they are cheap during construction and expensive to retrofit:

- Semantic form labels on all inputs
- Visible focus indicators on all interactive elements
- Sufficient color contrast on text and controls
- Keyboard operability of all controls

**Out of scope:** a visually-hidden data table conveying Sankey content to
screen readers.

---

### R-QA-3 — Mobile [Confirmed]

Mobile remains functional but is not a polish priority. This is a
prioritization statement, not a feature: **no mobile-specific behavior is to
be built and no functionality is to be hidden on small screens.**

---

## 7. Future considerations (not this release)

### R-FUT-1 — JSON export/import format

A deliberate JSON file format is the natural bridge to a possible future
Electron application. It is not required now, but the internal data model
should be shaped so that serializing it to a stable external format later is
straightforward. Avoid decisions that make the model hard to export.

### R-FUT-2 — Integration with other tools [Out of scope]

Cashkey will not read data from the net worth workbook or DebtReduce. It
remains standalone. A shared file format is the only contemplated bridge.
