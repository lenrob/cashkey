import { CashflowItem } from '../types/cashflow';
import { itemDisplayName } from './cashflowUtils';
import { rollupAmount } from './subcategoryUtils';

// Softer, more neutral color palette with accent colors
export const COLORS = {
  income: '#8E9EF0',   // Soft blue
  expense: '#9ADCB9',  // Soft green
  subcategory: '#C3ECD8', // Lighter green, one shade off expense for the 4th column
  surplus: '#9b87f5',  // Soft purple
  deficit: '#F7A097',  // Soft red-orange
  budget: '#F1C40F',   // Gold for budget node
};

/** A single child rendered in an expanded category's fourth column. */
export interface SubcategoryLayoutNode {
  id: string;
  label: string;
  amount: number;
  /** Percentage of the parent's own rolled-up total, not the whole budget —
   *  this column shows composition of the category, not share of the budget. */
  percentage: number;
}

/**
 * Layout data for one expanded expense category's fourth column. Percentages
 * are relative to the parent's rollup total (R-DM-3), so they sum to 100
 * across a category's children regardless of that category's share of the
 * overall budget.
 */
export const getSubcategoryLayoutNodes = (item: CashflowItem): SubcategoryLayoutNode[] => {
  const total = rollupAmount(item);
  return (item.children ?? []).map((child) => ({
    id: child.id,
    label: itemDisplayName(child),
    amount: child.amount,
    percentage: total > 0 ? (child.amount / total) * 100 : 0,
  }));
};

export const formatCurrencyValue = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
};

export const processSankeyData = (incomes: CashflowItem[], expenses: CashflowItem[]) => {
  if (!incomes.length && !expenses.length) {
    return { nodes: [], links: [] };
  }

  const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0);
  const totalExpense = expenses.reduce((sum, item) => sum + item.amount, 0);
  const balance = totalIncome - totalExpense;
  const hasDeficit = balance < 0;
  const totalBudget = Math.max(totalIncome, totalExpense);

  // Sort expenses by amount in descending order
  const sortedExpenses = [...expenses].sort((a, b) => b.amount - a.amount);
  
  // Sort incomes by amount in descending order
  const sortedIncomes = [...incomes].sort((a, b) => b.amount - a.amount);

  // Create nodes
  const nodes = [
    // Income nodes (left side)
    ...sortedIncomes.map((income) => {
      const percentage = Math.round((income.amount / totalBudget) * 100);
      const label = itemDisplayName(income);
      return {
        name: label,
        displayName: `${label}\n${percentage}%`,
        value: income.amount,
        percentage: percentage,
        itemId: income.id,
        category: 'income' as const,
        color: COLORS.income,
      };
    }),

    // Add deficit node on income side if expenses exceed income
    ...(hasDeficit ? [{
      name: '📉 Deficit',
      displayName: `Deficit\n${Math.round((Math.abs(balance) / totalBudget) * 100)}%`,
      value: Math.abs(balance),
      percentage: Math.round((Math.abs(balance) / totalBudget) * 100),
      category: 'income' as const,
      color: COLORS.deficit,
    }] : []),
    
    // Middle "Budget" node
    {
      name: 'Budget',
      displayName: 'Budget',
      value: totalBudget,
      category: 'balance' as const,
      color: COLORS.budget,
    },
    
    // Expense nodes (right side)
    ...sortedExpenses.map((expense) => {
      const percentage = Math.round((expense.amount / totalBudget) * 100);
      const label = itemDisplayName(expense);
      return {
        name: label,
        displayName: `${label}\n${percentage}%`,
        value: expense.amount,
        percentage: percentage,
        itemId: expense.id,
        category: 'expense' as const,
        color: COLORS.expense,
      };
    }),
    
    // Add surplus node on expense side if income exceeds expenses
    ...(!hasDeficit && balance > 0 ? [{
      name: '📈 Surplus',
      displayName: `Surplus\n${Math.round((balance / totalBudget) * 100)}%`,
      value: balance,
      percentage: Math.round((balance / totalBudget) * 100),
      category: 'balance' as const,
      color: COLORS.surplus,
    }] : [])
  ];

  // Calculate starting indices for different sections
  const incomeEndIndex = sortedIncomes.length + (hasDeficit ? 1 : 0);
  const budgetIndex = incomeEndIndex;

  // Create links
  const links = [
    // Income to Budget links
    ...sortedIncomes.map((income, index) => ({
      source: index,
      target: budgetIndex,
      value: income.amount,
    })),

    // Deficit to Budget link if needed
    ...(hasDeficit ? [{
      source: sortedIncomes.length,
      target: budgetIndex,
      value: Math.abs(balance),
    }] : []),
    
    // Budget to Expense links
    ...sortedExpenses.map((expense, index) => ({
      source: budgetIndex,
      target: budgetIndex + 1 + index,
      value: expense.amount,
    })),

    // Budget to Surplus link if needed
    ...(!hasDeficit && balance > 0 ? [{
      source: budgetIndex,
      target: nodes.length - 1,
      value: balance,
    }] : [])
  ];

  return { nodes, links };
};
