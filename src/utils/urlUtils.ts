import { CashflowItem, CashflowState } from '../types/cashflow';

/**
 * Why a payload produced no usable budget.
 *
 * One member today. PR 1.1 adds "not-a-budget" when Q4 is fixed — a scalar
 * payload is currently treated as an empty budget rather than a failure.
 */
export type LoadFailureReason = 'unreadable';

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
});

export const hasIssues = (issues: LoadIssues): boolean =>
  issues.repaired > 0 || issues.droppedMalformed > 0 || issues.droppedNegative > 0;

// A simpler and more URL-friendly encoding scheme
export const encodeState = (state: CashflowState): string => {
  try {
    return encodeURIComponent(JSON.stringify(state));
  } catch (error) {
    console.error('Error encoding state:', error);
    return '';
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
const validateItem = (raw: unknown, issues: LoadIssues): CashflowItem | null => {
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

  const item: CashflowItem = { id, name, amount };
  // Cosmetic and optional: kept when usable, stripped without comment when not.
  if (typeof raw.color === 'string') item.color = raw.color;
  return item;
};

const validateItems = (raw: unknown, issues: LoadIssues): CashflowItem[] => {
  if (!Array.isArray(raw)) return [];

  const items: CashflowItem[] = [];
  for (const entry of raw) {
    const item = validateItem(entry, issues);
    if (item !== null) items.push(item);
  }
  return items;
};

export const decodeState = (
  encoded: string,
  source: BudgetSource = 'url',
): BudgetLoadResult => {
  if (!encoded) return { status: 'absent' };

  const parsed = parseEncodedLayers(encoded);

  // JSON null threw on property access before this change, so it was a failure
  // then and stays one now. Other scalars decoded to an empty budget and still
  // do — that is Q4, deliberately left for PR 1.1 rather than smuggled in here.
  if (parsed === PARSE_FAILED || parsed === null) {
    console.error('Error decoding state: the data parameter could not be read');
    return { status: 'invalid', reason: 'unreadable' };
  }

  const record = isRecord(parsed) ? parsed : {};
  const issues = noIssues();

  return {
    status: 'loaded',
    state: {
      incomes: validateItems(record.incomes, issues),
      expenses: validateItems(record.expenses, issues),
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
 */
export const describeLoadIssues = (issues: LoadIssues): string | null => {
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

  return `${parts.join(', ')}.`;
};

export const updateUrlWithState = (state: CashflowState): void => {
  const encodedState = encodeState(state);
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
