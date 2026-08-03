import { CashflowItem } from '@/types/cashflow';

/**
 * Formats a number as a currency string
 */
export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
};

/**
 * Emoji and name concatenated for display, matching the pre-PR-1.2 look
 * where emoji lived inside the name string.
 */
export const itemDisplayName = (item: Pick<CashflowItem, 'emoji' | 'name'>) =>
  item.emoji ? `${item.emoji} ${item.name}` : item.name;
