import { CashflowItem, Frequency } from '@/types/cashflow';

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

/**
 * `amount` on a CashflowItem is always annual. These two functions are the
 * only place that invariant is crossed, in either direction: `toAnnual` for
 * turning a typed entry into what gets stored, `fromAnnual` for turning a
 * stored value into what's shown (per-item on entry, or globally on
 * display — same conversion either way).
 *
 * Rounding: neither function rounds. $100/year is $8.333.../month, and that
 * full-precision value is what gets returned. Rounding happens only at the
 * two presentation boundaries, never fed back into state:
 * - read-only display (list rows, totals) relies on `formatCurrency`'s own
 *   `maximumFractionDigits: 0`
 * - an editable amount field is seeded with a rounded string for display,
 *   but that's a UI seed value, not a stored one
 *
 * This can't drift for anything entered through this app's own UI: a
 * monthly entry is always `toAnnual(typedInteger, 'monthly')` — an exact
 * multiple of 12 — so `fromAnnual` on it is always an exact integer back.
 * $1,384/month round-trips to $16,608/year and back to $1,384/month with no
 * rounding step ever engaged. Fractional remainders only arise from an
 * annual amount that isn't a multiple of 12 combined with a monthly
 * frequency — not reachable via add/edit, only via a hand-edited URL.
 */
export const toAnnual = (amount: number, frequency: Frequency): number =>
  frequency === 'monthly' ? amount * 12 : amount;

export const fromAnnual = (annualAmount: number, frequency: Frequency): number =>
  frequency === 'monthly' ? annualAmount / 12 : annualAmount;
