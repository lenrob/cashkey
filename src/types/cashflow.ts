
export type Frequency = 'monthly' | 'annual';

interface CashflowItemBase {
  id: string;
  name: string;
  /** Always normalized to annual, regardless of `frequency`. */
  amount: number;
  /** The unit the item was entered in. Display-only elsewhere; never
   *  changes what `amount` means. */
  frequency: Frequency;
  emoji?: string;
  color?: string;
}

/** A subcategory. No `children` field — nesting is one level deep (R-DM-3),
 *  enforced here at the type level rather than by convention alone. */
export type CashflowSubItem = CashflowItemBase;

export interface CashflowItem extends CashflowItemBase {
  /** One level of subcategories (R-DM-3). Expenses only — never populated
   *  on an income item. When present and non-empty, `amount` is derived:
   *  kept in sync with the sum of children by every mutation path in
   *  `subcategoryUtils.ts`, and never trusted from a serialized payload —
   *  see `withRolledUpAmount`. */
  children?: CashflowSubItem[];
}

export interface SankeyNode {
  name: string;
  value?: number;
  itemId?: string;
  category: 'income' | 'expense' | 'balance';
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface CashflowState {
  incomes: CashflowItem[];
  expenses: CashflowItem[];
}
