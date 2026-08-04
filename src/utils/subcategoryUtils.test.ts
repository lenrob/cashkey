import { describe, it, expect } from 'vitest';
import { CashflowItem, CashflowSubItem } from '@/types/cashflow';
import {
  rollupAmount,
  withRolledUpAmount,
  hasDirectAmountConflict,
  addSubcategory,
  removeSubcategory,
  preservedChildId,
  SubcategoryConflictError,
} from './subcategoryUtils';

const parent = (overrides: Partial<CashflowItem> = {}): CashflowItem => ({
  id: 'parent-1',
  name: 'Housing',
  amount: 2000,
  frequency: 'annual',
  ...overrides,
});

const child = (overrides: Partial<CashflowSubItem> = {}): CashflowSubItem => ({
  id: crypto.randomUUID(),
  name: 'Mortgage',
  amount: 1500,
  frequency: 'annual',
  ...overrides,
});

describe('rollupAmount', () => {
  it('returns the item amount unchanged when there are no children', () => {
    expect(rollupAmount(parent())).toBe(2000);
  });

  it('sums children when present', () => {
    const p = parent({ children: [child({ amount: 500 }), child({ amount: 300 })] });
    expect(rollupAmount(p)).toBe(800);
  });

  it('treats an empty children array as flat', () => {
    expect(rollupAmount(parent({ children: [] }))).toBe(2000);
  });
});

describe('withRolledUpAmount', () => {
  it('leaves a flat item alone', () => {
    const p = parent();
    expect(withRolledUpAmount(p)).toEqual(p);
  });

  it('overwrites a mismatched parent amount with the rollup', () => {
    const p = parent({ amount: 999999, children: [child({ amount: 100 }), child({ amount: 50 })] });
    expect(withRolledUpAmount(p).amount).toBe(150);
  });
});

describe('hasDirectAmountConflict', () => {
  it('is true for a parent with a direct amount and no children', () => {
    expect(hasDirectAmountConflict(parent())).toBe(true);
  });

  it('is false for a parent with a zero amount', () => {
    expect(hasDirectAmountConflict(parent({ amount: 0 }))).toBe(false);
  });

  it('is false once the parent already has children', () => {
    expect(hasDirectAmountConflict(parent({ children: [child()] }))).toBe(false);
  });
});

describe('addSubcategory', () => {
  it('throws without a strategy when the parent holds a direct amount', () => {
    expect(() => addSubcategory(parent(), child())).toThrow(SubcategoryConflictError);
  });

  it('does not require a strategy when the parent amount is already zero', () => {
    const result = addSubcategory(parent({ amount: 0 }), child({ amount: 400 }));
    expect(result.children).toHaveLength(1);
    expect(result.amount).toBe(400);
  });

  it('does not require a strategy once the parent already has children', () => {
    const withOneChild = parent({ children: [child({ amount: 1500 })] });
    const result = addSubcategory(withOneChild, child({ name: 'Insurance', amount: 300 }));
    expect(result.children).toHaveLength(2);
    expect(result.amount).toBe(1800);
  });

  it("'preserve' carries the parent's old amount forward as a distinctly-named child", () => {
    const result = addSubcategory(parent(), child({ amount: 1500 }), 'preserve');
    expect(result.children).toHaveLength(2);
    const preserved = result.children!.find((c) => c.name !== 'Mortgage')!;
    expect(preserved.name).toBe('Housing (unallocated)');
    expect(preserved.name).not.toBe(parent().name);
    expect(preserved.amount).toBe(2000);
    expect(result.amount).toBe(3500);
  });

  it("'discard' drops the parent's old amount entirely", () => {
    const result = addSubcategory(parent(), child({ amount: 1500 }), 'discard');
    expect(result.children).toHaveLength(1);
    expect(result.amount).toBe(1500);
  });
});

describe('removeSubcategory', () => {
  it('reverts the parent to a direct amount of 0 when the last child is removed', () => {
    const only = child({ amount: 1500 });
    const withChild = parent({ amount: 1500, children: [only] });
    const result = removeSubcategory(withChild, only.id);
    expect(result.children).toBeUndefined();
    expect(result.amount).toBe(0);
  });

  it('re-rolls up the remaining children rather than reverting when others remain', () => {
    const a = child({ amount: 1500 });
    const b = child({ amount: 300 });
    const withChildren = parent({ amount: 1800, children: [a, b] });
    const result = removeSubcategory(withChildren, a.id);
    expect(result.children).toEqual([b]);
    expect(result.amount).toBe(300);
  });

  it('parent total always equals the sum of its children after add/remove', () => {
    let p = parent({ amount: 0 });
    p = addSubcategory(p, child({ name: 'Mortgage', amount: 1500 }));
    p = addSubcategory(p, child({ name: 'Insurance', amount: 300 }));
    p = addSubcategory(p, child({ name: 'Property Tax', amount: 700 }));
    expect(p.amount).toBe(rollupAmount(p));

    p = removeSubcategory(p, p.children![0].id);
    expect(p.amount).toBe(rollupAmount(p));
  });

  it('removing the last child and adding again does not require a strategy', () => {
    // The conflict only fires for a *direct* amount. Once the last child is
    // removed, removeSubcategory has already zeroed the parent's amount, so
    // this is the same no-conflict path as a brand-new zero-amount parent —
    // not a special case, but worth pinning down explicitly.
    let p = parent({ amount: 2000 });
    p = addSubcategory(p, child({ amount: 2000 }), 'discard');
    expect(hasDirectAmountConflict(p)).toBe(false);

    p = removeSubcategory(p, p.children![0].id);
    expect(p.amount).toBe(0);
    expect(hasDirectAmountConflict(p)).toBe(false);

    expect(() => addSubcategory(p, child({ name: 'Rent', amount: 1800 }))).not.toThrow();
  });
});

describe('preservedChildId', () => {
  it("identifies the preserved child after a 'preserve' add", () => {
    const added = child({ amount: 1500 });
    const result = addSubcategory(parent(), added, 'preserve');
    const preservedId = preservedChildId(result, added.id);
    expect(preservedId).not.toBeNull();
    expect(result.children!.find((c) => c.id === preservedId)!.name).toBe('Housing (unallocated)');
  });

  it("returns null after a 'discard' add, where the added child is the only one", () => {
    const added = child({ amount: 1500 });
    const result = addSubcategory(parent(), added, 'discard');
    expect(preservedChildId(result, added.id)).toBeNull();
  });

  it('returns null when the parent has no children at all', () => {
    expect(preservedChildId(parent(), 'anything')).toBeNull();
  });
});
