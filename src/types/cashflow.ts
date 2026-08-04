
export type Frequency = 'monthly' | 'annual';

export interface CashflowItem {
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
