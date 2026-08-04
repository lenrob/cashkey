import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashflowState } from '../types/cashflow';
import { CURRENT_SCHEMA_VERSION } from './urlUtils';
import { deleteBudget, listBudgets, loadBudget, renameBudget, saveBudget } from './storageUtils';

/** A minimal in-memory Storage implementation — Node has no localStorage. */
class FakeLocalStorage implements Storage {
  private store = new Map<string, string>();
  quotaBytes = Infinity;

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (value.length > this.quotaBytes) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const sampleState: CashflowState = {
  incomes: [{ id: 'i1', name: 'Salary', amount: 100000, frequency: 'annual' }],
  expenses: [{ id: 'e1', name: 'Housing', amount: 20000, frequency: 'annual' }],
};

let fakeStorage: FakeLocalStorage;

beforeEach(() => {
  fakeStorage = new FakeLocalStorage();
  vi.stubGlobal('localStorage', fakeStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveBudget / loadBudget', () => {
  it('round-trips a budget', () => {
    const saved = saveBudget('My Budget', sampleState);
    expect(saved.status).toBe('ok');
    const id = saved.status === 'ok' ? saved.value : '';

    const loaded = loadBudget(id);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.state).toEqual(sampleState);
      expect(loaded.source).toBe('storage');
      expect(loaded.savedAs).toBe(id);
    }
  });

  it('stamps the current schema version so a future bump does not misread it', () => {
    const saved = saveBudget('Stamped', sampleState);
    const id = saved.status === 'ok' ? saved.value : '';
    const raw = fakeStorage.getItem(`cashkey:budget:${id}`);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('loading a missing id returns absent', () => {
    expect(loadBudget('nonexistent')).toEqual({ status: 'absent' });
  });

  it('a budget saved under an older schema version migrates on load', () => {
    const id = 'legacy-id';
    // v1 shape: no version field, emoji embedded in the name.
    fakeStorage.setItem(
      `cashkey:budget:${id}`,
      JSON.stringify({
        incomes: [{ id: 'i1', name: '🏡 Salary', amount: 1000, frequency: 'annual' }],
        expenses: [],
        name: 'Old Budget',
      }),
    );

    const loaded = loadBudget(id);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.state.incomes[0]).toMatchObject({ name: 'Salary', emoji: '🏡' });
      expect(loaded.issues.migrated).toBeGreaterThan(0);
    }
  });

  it('a version newer than this build is rejected, not misread', () => {
    const id = 'future-id';
    fakeStorage.setItem(
      `cashkey:budget:${id}`,
      JSON.stringify({ version: CURRENT_SCHEMA_VERSION + 1, incomes: [], expenses: [], name: 'x' }),
    );

    expect(loadBudget(id)).toEqual({ status: 'invalid', reason: 'unsupported-version' });
  });
});

describe('listBudgets', () => {
  it('lists saved budgets in creation order', () => {
    saveBudget('First', sampleState);
    saveBudget('Second', sampleState);

    const result = listBudgets();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value.map((b) => b.name)).toEqual(['First', 'Second']);
    }
  });

  it('skips a phantom index entry whose budget key is missing', () => {
    const saved = saveBudget('Real', sampleState);
    const id = saved.status === 'ok' ? saved.value : '';
    // Simulate a save that died between writing the budget key and the
    // index: an id present in the index with no backing payload.
    fakeStorage.setItem('cashkey:budgets', JSON.stringify([id, 'ghost-id']));

    const result = listBudgets();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value.map((b) => b.id)).toEqual([id]);
    }
  });
});

describe('renameBudget', () => {
  it('renames in place without changing the id or list position', () => {
    const a = saveBudget('A', sampleState);
    const b = saveBudget('B', sampleState);
    const idA = a.status === 'ok' ? a.value : '';
    const idB = b.status === 'ok' ? b.value : '';

    renameBudget(idA, 'Renamed A');

    const result = listBudgets();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value).toEqual([
        { id: idA, name: 'Renamed A' },
        { id: idB, name: 'B' },
      ]);
    }
  });

  it('is a no-op when the id does not exist', () => {
    expect(renameBudget('missing', 'X')).toEqual({ status: 'ok', value: undefined });
  });
});

describe('deleteBudget', () => {
  it('removes the budget from the index and storage', () => {
    const saved = saveBudget('Gone Soon', sampleState);
    const id = saved.status === 'ok' ? saved.value : '';

    deleteBudget(id);

    expect(loadBudget(id)).toEqual({ status: 'absent' });
    const result = listBudgets();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.value).toEqual([]);
  });
});

describe('quota and availability failures', () => {
  it('surfaces quota-exceeded on save without touching the index', () => {
    fakeStorage.quotaBytes = 10;
    const result = saveBudget('Too Big', sampleState);
    expect(result).toEqual({ status: 'error', reason: 'quota-exceeded' });
    expect(fakeStorage.getItem('cashkey:budgets')).toBeNull();
  });

  it('surfaces unavailable when localStorage itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    });

    expect(saveBudget('X', sampleState)).toEqual({ status: 'error', reason: 'unavailable' });
    expect(loadBudget('any')).toEqual({ status: 'invalid', reason: 'unreadable' });
  });
});
