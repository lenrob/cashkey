import { CashflowState } from '../types/cashflow';
import { BudgetLoadResult, CURRENT_SCHEMA_VERSION, decodeState } from './urlUtils';

/**
 * Result of a storage write/read that can fail for reasons outside the
 * caller's control (quota, storage disabled). Returned rather than thrown —
 * there is no UI yet to catch an exception, and a value sitting unused is
 * safer than a swallowed one. Mirrors the BudgetLoadResult pattern already
 * established for URL decoding.
 */
export type StorageResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; reason: 'quota-exceeded' | 'unavailable' };

/**
 * The library is one index key (an ordered array of ids) plus one key per
 * budget. A single blob holding every budget was considered and rejected:
 * every save would rewrite the whole library, sizing quota failures to the
 * library's total size rather than to the one budget being saved, and a
 * failed write risks the *other* budgets too depending on browser behavior.
 * One key per budget means a quota failure on a large budget never touches
 * the rest of the library. The index key is still a single blob, but it only
 * holds ids, so its size tracks budget *count*, not budget *size*.
 */
const INDEX_KEY = 'cashkey:budgets';
const budgetKey = (id: string): string => `cashkey:budget:${id}`;

/**
 * A budget's storage key is assigned once at creation (a random id) and
 * never changes. The user-supplied `name` is just a field inside the stored
 * JSON, rewritten in place on rename. This is deliberate: names are mutable
 * and can collide (two budgets named "2026"), so they can't double as
 * identity. It also means rename never has to move data between keys —
 * localStorage has no atomic rename, so a rename-via-move (write new key,
 * delete old key) would risk losing the budget if it died between the two.
 */
const isQuotaExceeded = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (error as { code?: number }).code === 22 ||
    (error as { code?: number }).code === 1014);

const withStorage = <T>(fn: () => T): StorageResult<T> => {
  try {
    return { status: 'ok', value: fn() };
  } catch (error) {
    return { status: 'error', reason: isQuotaExceeded(error) ? 'quota-exceeded' : 'unavailable' };
  }
};

const readIndex = (): string[] => {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const writeIndex = (ids: string[]): void => {
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
};

/**
 * Save and delete each touch two keys (the budget, then the index) and
 * either write can fail independently — quota can be hit on either one.
 * That desync is handled, not prevented:
 *
 * - saveBudget writes the budget key first, then appends to the index. A
 *   failure on the second write leaves an orphan (budget stored, unlisted)
 *   but never a phantom (nothing is indexed that doesn't exist).
 * - deleteBudget removes the index entry first, then the budget key. A
 *   failure on the second delete also leaves an orphan, never a phantom.
 *
 * Orphans are accepted as a leak rather than recovered. Recovering them
 * would mean scanning every localStorage key for a "cashkey:budget:*"
 * prefix on every list, which is real cost for a failure mode that's both
 * rare (only on a write that already reported an error to the caller) and
 * harmless (a few stray KB, never a broken or missing budget). listBudgets
 * still skips any index entry that doesn't resolve to a valid stored budget
 * — defensive against manual tampering or a corrupted key, not the primary
 * mechanism keeping the library consistent.
 *
 * List order is creation order: new ids are appended, so listBudgets
 * returns budgets oldest-saved-first. R-CMP-1 doesn't specify an order;
 * this is the natural one from append-only index writes and rename doesn't
 * touch the index, so renaming never reorders the list.
 */
export const saveBudget = (
  name: string,
  state: CashflowState,
  id: string = crypto.randomUUID(),
): StorageResult<string> =>
  withStorage(() => {
    const payload = JSON.stringify({ version: CURRENT_SCHEMA_VERSION, ...state, name });
    localStorage.setItem(budgetKey(id), payload);

    const index = readIndex();
    if (!index.includes(id)) writeIndex([...index, id]);

    return id;
  });

export const renameBudget = (id: string, name: string): StorageResult<void> =>
  withStorage(() => {
    const raw = localStorage.getItem(budgetKey(id));
    // Nothing to rename. Treated as a no-op rather than a new failure mode —
    // consistent with the leak-tolerant handling of missing keys elsewhere
    // in this module.
    if (raw === null) return;

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    localStorage.setItem(budgetKey(id), JSON.stringify({ ...parsed, name }));
  });

export const deleteBudget = (id: string): StorageResult<void> =>
  withStorage(() => {
    writeIndex(readIndex().filter((existingId) => existingId !== id));
    localStorage.removeItem(budgetKey(id));
  });

/**
 * Reads each budget's full payload through decodeState to get its name,
 * rather than duplicating `name` into the index for a cheaper list read.
 * Duplicating it would create two sources of truth that rename would have
 * to keep in sync — for a personal library of a dozen budgets, the wasted
 * parse is cheaper than that bug. Do not "optimize" this into an index-held
 * name later without solving that sync problem first.
 */
export const listBudgets = (): StorageResult<Array<{ id: string; name: string }>> =>
  withStorage(() => {
    const budgets: Array<{ id: string; name: string }> = [];

    for (const id of readIndex()) {
      const raw = localStorage.getItem(budgetKey(id));
      // Phantom: indexed but the payload is missing (a save/delete died
      // between its two writes — see module doc above). Skipped, not
      // surfaced as a broken row, and the index isn't rewritten to drop it
      // here — a transient read glitch shouldn't cause a permanent one.
      if (raw === null) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (decodeState(raw, 'storage').status !== 'loaded') continue;

      budgets.push({ id, name: typeof parsed.name === 'string' ? parsed.name : 'Untitled' });
    }

    return budgets;
  });

export const loadBudget = (id: string): BudgetLoadResult => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(budgetKey(id));
  } catch {
    return { status: 'invalid', reason: 'unreadable' };
  }
  if (raw === null) return { status: 'absent' };

  const result = decodeState(raw, 'storage');
  return result.status === 'loaded' ? { ...result, savedAs: id } : result;
};
