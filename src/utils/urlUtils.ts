import { CashflowItem, CashflowState, CashflowSubItem } from '../types/cashflow';
import { withRolledUpAmount } from './subcategoryUtils';

/**
 * Why a payload produced no usable budget.
 *
 * - 'unreadable': the payload could not be parsed at all, or is well-formed
 *   but not shaped like a budget (Q4 — a bare scalar or array).
 * - 'not-a-budget': parsed to something other than a record.
 * - 'unsupported-version': parsed fine, but stamped with a schema version
 *   newer than this build knows how to migrate. Distinct from 'unreadable'
 *   because the link isn't broken — the user's app is behind.
 */
export type LoadFailureReason = 'unreadable' | 'not-a-budget' | 'unsupported-version';

/** Where a budget came from. "storage" lands in PR 2.1, "sample" in PR 2.3. */
export type BudgetSource = 'url' | 'storage' | 'sample';

export interface LoadIssues {
  /** Items kept after repairing a field: missing id, blank name, numeric string. */
  repaired: number;
  /** Items dropped for having no usable amount — nothing could be drawn. */
  droppedMalformed: number;
  /** Items dropped for a negative amount. Counted apart from the malformed:
   *  a negative expense is intent expressed wrongly, most likely a refund or
   *  a credit, and that signal is worth keeping distinct. */
  droppedNegative: number;
  /** Items a version migration actually changed, brought forward from an
   *  older schema. Distinct from `repaired`: a migrated item's data was fine
   *  for its era, it just needed updating to the current shape. Reporting it
   *  as repaired would tell the user their intact old link is damaged. */
  migrated: number;
}

export type BudgetLoadResult =
  | { status: 'absent' }
  | { status: 'invalid'; reason: LoadFailureReason }
  | {
      status: 'loaded';
      state: CashflowState;
      source: BudgetSource;
      /** Identity in the saved library. null means unsaved scratch (R-PER-2). */
      savedAs: string | null;
      issues: LoadIssues;
    };

export const noIssues = (): LoadIssues => ({
  repaired: 0,
  droppedMalformed: 0,
  droppedNegative: 0,
  migrated: 0,
});

export const hasIssues = (issues: LoadIssues): boolean =>
  issues.repaired > 0 ||
  issues.droppedMalformed > 0 ||
  issues.droppedNegative > 0 ||
  issues.migrated > 0;

/**
 * The schema version this build writes and can read up to. Bumped whenever
 * a PR changes the shape of a serialized item or record (PR 1.2 emoji, PR 1.3
 * frequency, ...). A migration must be registered in MIGRATIONS for every
 * version below this one.
 */
export const CURRENT_SCHEMA_VERSION = 4;

// A simpler and more URL-friendly encoding scheme.
// Returns null (not "") on failure, so a write failure stays distinguishable
// from "no data in the URL" — see Q6 in the implementation plan.
export const encodeState = (state: CashflowState): string | null => {
  try {
    return encodeURIComponent(
      JSON.stringify({ version: CURRENT_SCHEMA_VERSION, ...state }),
    );
  } catch (error) {
    console.error('Error encoding state:', error);
    return null;
  }
};

/**
 * How many layers of percent-encoding to peel before giving up.
 *
 * The app writes two: encodeState percent-encodes the JSON, then
 * URLSearchParams.set encodes the resulting % signs again. searchParams.get
 * peels one before this function ever sees the string, so one layer is the
 * normal case and three is generous headroom for links mangled in transit.
 */
const MAX_ENCODING_LAYERS = 3;

const PARSE_FAILED = Symbol('parse-failed');

/**
 * Parse first, decode only on failure.
 *
 * The order matters. Decoding first corrupts input that is already plain JSON:
 * a category named "100%20 off" would decode to "100 off" with no error raised
 * and no way to notice. Parsing first means an already-decoded payload is never
 * touched, and a payload with a bare % — "50% Rule" — no longer throws URIError
 * and lose the entire budget.
 */
const parseEncodedLayers = (encoded: string): unknown => {
  let candidate = encoded;

  for (let layer = 0; layer < MAX_ENCODING_LAYERS; layer += 1) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Not JSON at this layer. Peel one layer of encoding and try again.
    }

    let peeled: string;
    try {
      peeled = decodeURIComponent(candidate);
    } catch {
      return PARSE_FAILED;
    }

    if (peeled === candidate) return PARSE_FAILED;
    candidate = peeled;
  }

  return PARSE_FAILED;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A finite number, or a string that cleanly represents one. */
const readAmount = (raw: unknown): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // Number("") is 0, which would invent money that was never in the link.
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

/**
 * Coerce what is unambiguous, drop what is not, and count either way.
 *
 * For a budget tool the worst outcome is a total that changed without anyone
 * noticing — worse than a visibly odd row. So an item keeps its amount whenever
 * the amount itself is sound, and is only discarded when it cannot be drawn.
 */
/**
 * `allowChildren` gates subcategory support to expenses only (R-DM-3):
 * income call sites pass `false`, so a `children` array on a raw income item
 * is never even read, let alone validated. When `true`, each raw child is
 * validated through this same function with `allowChildren: false` — reusing
 * the drop-and-count rules above, and enforcing one-level nesting by
 * construction, since that recursive call can never itself produce a
 * `children` field on the result.
 */
const validateItem = (
  raw: unknown,
  issues: LoadIssues,
  allowChildren: boolean = false,
): CashflowItem | null => {
  if (!isRecord(raw)) {
    issues.droppedMalformed += 1;
    return null;
  }

  const amount = readAmount(raw.amount);
  if (amount === null) {
    issues.droppedMalformed += 1;
    return null;
  }
  if (amount < 0) {
    issues.droppedNegative += 1;
    return null;
  }

  let repaired = typeof raw.amount !== 'number';

  let frequency: CashflowItem['frequency'];
  if (raw.frequency === 'monthly' || raw.frequency === 'annual') {
    frequency = raw.frequency;
  } else {
    // Not "old" — a version below current is backfilled by the v2->v3
    // migration before this ever runs. A missing/invalid frequency here
    // means a current-shape payload had a bad value (hand-edited URL,
    // typo'd "weekly"), which is validateItem's job to coerce, same as a
    // bad id or name.
    frequency = 'annual';
    repaired = true;
  }

  let id: string;
  if (typeof raw.id === 'string' && raw.id.trim() !== '') {
    id = raw.id;
  } else {
    // Ids carry no user meaning. Discarding money over a missing one is absurd.
    id = crypto.randomUUID();
    repaired = true;
  }

  let name: string;
  if (typeof raw.name === 'string' && raw.name.trim() !== '') {
    name = raw.name;
  } else {
    // Keeps the total honest, and a visible "Untitled" row invites a correction.
    name = 'Untitled';
    repaired = true;
  }

  if (repaired) issues.repaired += 1;

  const item: CashflowItem = { id, name, amount, frequency };
  // Cosmetic and optional: kept when usable, stripped without comment when not.
  if (typeof raw.color === 'string') item.color = raw.color;
  if (typeof raw.emoji === 'string') item.emoji = raw.emoji;

  if (allowChildren && Array.isArray(raw.children)) {
    const children: CashflowSubItem[] = [];
    for (const rawChild of raw.children) {
      const validatedChild = validateItem(rawChild, issues, false);
      if (validatedChild !== null) children.push(validatedChild);
    }
    if (children.length > 0) item.children = children;
  }

  // A parent's serialized `amount` is never trusted over its own children —
  // storing both independently invites drift, so this recomputes it from
  // whatever children survived validation above.
  return withRolledUpAmount(item);
};

const validateItems = (
  raw: unknown,
  issues: LoadIssues,
  allowChildren: boolean = false,
): CashflowItem[] => {
  if (!Array.isArray(raw)) return [];

  const items: CashflowItem[] = [];
  for (const entry of raw) {
    const item = validateItem(entry, issues, allowChildren);
    if (item !== null) items.push(item);
  }
  return items;
};

/**
 * Brings a raw parsed record from the version it arrived as up to the shape
 * this build expects. Runs before validation, on the raw record — migration's
 * job is to recognize "old" and update it, not to judge whether current-shape
 * data is usable (that's validateItem's job, unchanged).
 *
 * A migration may touch the whole record (a version whose backfill needs
 * global state — no real migration has needed this yet; PR 1.3's frequency
 * backfill turned out not to, see `migrateFrequencyField`) or map over a
 * single raw item (e.g. PR 1.2's per-item emoji extraction, PR 1.3's
 * per-item frequency stamp) — this signature supports both, since either
 * just returns a transformed record.
 *
 * Each migration receives `issues` and must increment `issues.migrated`
 * itself, once per item it actually changes. Items already in the shape a
 * migration produces must be left alone and not counted — otherwise a link
 * where only 3 of 16 items needed updating would report all 16, which is the
 * same noise that folding migrations into `repaired` would create.
 */
type Migration = (
  record: Record<string, unknown>,
  issues: LoadIssues,
) => Record<string, unknown>;

/**
 * Matches a leading run of one or more pictographic characters, each
 * optionally followed by a variation selector (U+FE0F, as in the sample
 * data's 🏝️/🛍️/🎗️) or an emoji modifier (skin tone). Deliberately does not
 * match ZWJ (U+200D): a family emoji like 👨‍👩‍👧 is three pictographs joined
 * by ZWJ, and this pattern stops at the first one, which is what makes the
 * ambiguity check below reject it rather than split it in half.
 */
const LEADING_EMOJI_RUN = new RegExp(
  '^(?:\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)+',
  'u',
);

/**
 * Splits a leading emoji off a v1 `name`, or returns null when extraction
 * would be a guess rather than a detection (R-DM-2: undetectable cases leave
 * the whole string as the name).
 *
 * Two conditions must both hold:
 * - the run is followed by whitespace, not run straight into more text
 *   ("🏡Housing" has no separator — extracting there assumes a boundary
 *   that isn't marked)
 * - the remainder is non-empty after trimming that whitespace (an
 *   emoji-only name like "🏡" would otherwise split into an empty name)
 *
 * A leading multi-emoji run ("🎉🎊 Party") is extracted as one unit — this is
 * "the leading emoji", not "the leading single character". ZWJ sequences and
 * regional-indicator flag pairs never reach the whitespace check: the regex
 * doesn't cross a ZWJ, and a flag pair (two regional indicators, no gap) has
 * no separator either, so both fall through to null here as well.
 */
const extractLeadingEmoji = (name: string): { emoji: string; name: string } | null => {
  const match = LEADING_EMOJI_RUN.exec(name);
  if (!match) return null;

  const rest = name.slice(match[0].length);
  if (!/^\s/.test(rest)) return null;

  const trimmedRest = rest.replace(/^\s+/, '');
  if (trimmedRest === '') return null;

  return { emoji: match[0], name: trimmedRest };
};

/**
 * v1 -> v2: emoji moves out of `name` into its own field (R-DM-2). Maps over
 * both lists; an item is only rewritten, and only counted in
 * issues.migrated, when a leading emoji was actually detected. An item with
 * no emoji, or one that already carries an `emoji` key, passes through
 * unchanged and uncounted.
 */
const migrateEmojiField: Migration = (record, issues) => {
  const migrateItem = (raw: unknown): unknown => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || 'emoji' in raw) return raw;

    const extracted = extractLeadingEmoji(raw.name);
    if (!extracted) return raw;

    issues.migrated += 1;
    return { ...raw, name: extracted.name, emoji: extracted.emoji };
  };

  return {
    ...record,
    incomes: Array.isArray(record.incomes) ? record.incomes.map(migrateItem) : record.incomes,
    expenses: Array.isArray(record.expenses) ? record.expenses.map(migrateItem) : record.expenses,
  };
};

/**
 * v2 -> v3: backfill `frequency` on items that predate it (R-DM-1).
 *
 * IMPORTANT — this is an assumption, not recovered intent. The pre-1.3 UI's
 * monthly/annual period selector was never persisted: it converted a typed
 * monthly figure to annual *before* the item was constructed, then threw the
 * choice away. So a v2 item entered as $500/month and one entered as
 * $6,000/year are byte-for-byte identical on disk — nothing distinguishes
 * them. Every v2 item that was ever serialized has an annual `amount` by
 * construction (the entry-time conversion always ran before storage), so
 * `'annual'` is the only value that doesn't invent a monthly entry-frequency
 * that was never recorded. Nobody reading `migrated` counts or a `frequency`
 * value on a pre-1.3 item should mistake this backfill for a preserved user
 * choice — it isn't one, because the app never had one to preserve.
 *
 * (This also means there is no "global mode" to read off the record here,
 * unlike what an earlier draft of the implementation plan assumed — see
 * REQUIREMENTS.md R-DM-1. The pipeline shape from PR 1.1 still fits: this is
 * just a per-item migration like `migrateEmojiField`, mapping over both
 * lists and counting only the items it actually touches.)
 */
const migrateFrequencyField: Migration = (record, issues) => {
  const migrateItem = (raw: unknown): unknown => {
    if (!isRecord(raw) || raw.frequency === 'monthly' || raw.frequency === 'annual') {
      return raw;
    }

    issues.migrated += 1;
    return { ...raw, frequency: 'annual' };
  };

  return {
    ...record,
    incomes: Array.isArray(record.incomes) ? record.incomes.map(migrateItem) : record.incomes,
    expenses: Array.isArray(record.expenses) ? record.expenses.map(migrateItem) : record.expenses,
  };
};

/**
 * Keyed by the version a payload arrives as; migrates it one step forward.
 * Exported so tests can chain synthetic migrations without waiting for a
 * real schema change to exist.
 *
 * No entry for 3: the v3 bump (subcategories, PR 1.4) added `children` as
 * purely additive and optional, so a pre-v3 item is already valid v3 shape
 * as-is. `runMigrations` no-ops on a version with no registered step, which
 * is exactly correct here — not a forgotten migration.
 */
const MIGRATIONS: Record<number, Migration> = {
  1: migrateEmojiField,
  2: migrateFrequencyField,
};

export const runMigrations = (
  record: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, Migration>,
  issues: LoadIssues,
): Record<string, unknown> => {
  let current = record;
  for (let v = fromVersion; v < toVersion; v += 1) {
    const step = migrations[v];
    if (step) current = step(current, issues);
  }
  return current;
};

const readVersion = (record: Record<string, unknown>): number =>
  typeof record.version === 'number' ? record.version : 1;

export const decodeState = (
  encoded: string,
  source: BudgetSource = 'url',
): BudgetLoadResult => {
  if (!encoded) return { status: 'absent' };

  const parsed = parseEncodedLayers(encoded);

  // JSON null threw on property access before this change, so it was a failure
  // then and stays one now. Other scalars/arrays fail as 'not-a-budget' below.
  if (parsed === PARSE_FAILED || parsed === null) {
    console.error('Error decoding state: the data parameter could not be read');
    return { status: 'invalid', reason: 'unreadable' };
  }

  // Q4: a well-formed but non-record payload (?data=123, ?data=true,
  // ?data=[1,2,3]) is not an empty budget, it's not a budget at all.
  if (!isRecord(parsed)) {
    console.error('Error decoding state: the data parameter is not a budget');
    return { status: 'invalid', reason: 'not-a-budget' };
  }

  const version = readVersion(parsed);
  if (version > CURRENT_SCHEMA_VERSION) {
    console.error(`Error decoding state: unsupported schema version ${version}`);
    return { status: 'invalid', reason: 'unsupported-version' };
  }

  const issues = noIssues();
  const record = runMigrations(parsed, version, CURRENT_SCHEMA_VERSION, MIGRATIONS, issues);

  return {
    status: 'loaded',
    state: {
      incomes: validateItems(record.incomes, issues),
      expenses: validateItems(record.expenses, issues, true),
    },
    source,
    savedAs: null,
    issues,
  };
};

const countOf = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/**
 * A sentence describing what a load had to change, or null when it changed
 * nothing. Lives here rather than in the component so it can be tested.
 *
 * `source` defaults to 'url' so every existing call site (all of them
 * currently loading from the URL) keeps its wording unchanged. PR 2.1 adds
 * the 'storage' case: "an older link format" is wrong for a saved budget,
 * which was never a link.
 */
export const describeLoadIssues = (
  issues: LoadIssues,
  source: BudgetSource = 'url',
): string | null => {
  if (!hasIssues(issues)) return null;

  const parts: string[] = [];
  if (issues.droppedMalformed > 0) {
    parts.push(`${countOf(issues.droppedMalformed)} could not be read`);
  }
  if (issues.droppedNegative > 0) {
    parts.push(`${countOf(issues.droppedNegative)} had a negative amount`);
  }
  if (issues.repaired > 0) {
    const verb = issues.repaired === 1 ? 'was' : 'were';
    parts.push(`${countOf(issues.repaired)} ${verb} repaired`);
  }
  if (issues.migrated > 0) {
    const origin = source === 'storage' ? 'an older saved budget format' : 'an older link format';
    parts.push(`${countOf(issues.migrated)} updated from ${origin}`);
  }

  return `${parts.join(', ')}.`;
};

export const updateUrlWithState = (state: CashflowState): void => {
  const encodedState = encodeState(state);
  // Q6: a failed encode must not overwrite a good URL with an empty one, and
  // must not be silently indistinguishable from "no data in the URL" either.
  // Leaving the URL untouched is the safe default until this needs surfacing.
  if (encodedState === null) return;

  const url = new URL(window.location.href);
  url.searchParams.set('data', encodedState);
  window.history.replaceState({}, '', url.toString());
};

export const getStateFromUrl = (): BudgetLoadResult => {
  const url = new URL(window.location.href);
  const encodedState = url.searchParams.get('data');

  if (!encodedState) return { status: 'absent' };

  return decodeState(encodedState, 'url');
};
