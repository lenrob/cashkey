import { describe, it, expect } from 'vitest';
import { CashflowItem } from '@/types/cashflow';
import { getSubcategoryLayoutNodes } from './sankeyUtils';

const parent = (overrides: Partial<CashflowItem> = {}): CashflowItem => ({
  id: 'parent-1',
  name: 'Housing',
  amount: 2000,
  frequency: 'annual',
  ...overrides,
});

describe('getSubcategoryLayoutNodes', () => {
  it('returns no nodes when the item has no children', () => {
    expect(getSubcategoryLayoutNodes(parent())).toEqual([]);
  });

  it('returns no nodes when children is an empty array', () => {
    expect(getSubcategoryLayoutNodes(parent({ children: [] }))).toEqual([]);
  });

  it('computes each child percentage relative to the rolled-up total, not the whole budget', () => {
    const item = parent({
      amount: 2000,
      children: [
        { id: 'c1', name: 'Mortgage', amount: 1500, frequency: 'annual' },
        { id: 'c2', name: 'Insurance', amount: 500, frequency: 'annual' },
      ],
    });

    const nodes = getSubcategoryLayoutNodes(item);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ id: 'c1', label: 'Mortgage', amount: 1500, percentage: 75 });
    expect(nodes[1]).toMatchObject({ id: 'c2', label: 'Insurance', amount: 500, percentage: 25 });
  });

  it('percentages sum to 100 across a category regardless of that category share of the overall budget', () => {
    const item = parent({
      children: [
        { id: 'c1', name: 'A', amount: 300, frequency: 'annual' },
        { id: 'c2', name: 'B', amount: 700, frequency: 'annual' },
      ],
    });

    const total = getSubcategoryLayoutNodes(item).reduce((sum, node) => sum + node.percentage, 0);
    expect(total).toBeCloseTo(100);
  });

  it('includes emoji in the label via itemDisplayName', () => {
    const item = parent({
      children: [{ id: 'c1', name: 'Mortgage', amount: 1500, frequency: 'annual', emoji: '🏦' }],
    });

    expect(getSubcategoryLayoutNodes(item)[0].label).toBe('🏦 Mortgage');
  });

  it('does not divide by zero when the parent total is zero', () => {
    const item = parent({
      amount: 0,
      children: [{ id: 'c1', name: 'Empty', amount: 0, frequency: 'annual' }],
    });

    expect(getSubcategoryLayoutNodes(item)[0].percentage).toBe(0);
  });
});
