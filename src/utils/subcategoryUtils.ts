import { CashflowItem, CashflowSubItem } from '@/types/cashflow';

/**
 * The parent's total when children exist, else its own amount unchanged
 * (a category with no subcategories behaves exactly as today — R-DM-3).
 */
export const rollupAmount = (item: CashflowItem): number =>
  item.children && item.children.length > 0
    ? item.children.reduce((sum, child) => sum + child.amount, 0)
    : item.amount;

/**
 * Overwrites `amount` with the rollup when children exist, so the invariant
 * "parent totals always equal the sum of their children" can't drift.
 * Called after every mutation to `children` below, and by `urlUtils` on
 * decode — a parent's serialized `amount` is never trusted over its own
 * children, since storing both independently invites exactly that drift.
 */
export const withRolledUpAmount = (item: CashflowItem): CashflowItem =>
  item.children && item.children.length > 0
    ? { ...item, amount: rollupAmount(item) }
    : item;

/**
 * 'preserve': the parent's existing direct amount survives as a new child,
 * so the figure is carried forward rather than lost.
 * 'discard': the parent's direct amount is dropped; only amounts entered
 * for subcategories count from here on.
 */
export type SubcategoryConflictStrategy = 'preserve' | 'discard';

/**
 * True only when adding a *first* child to `parent` would silently reinterpret
 * an existing direct amount (R-DM-3). Once a parent has any children, amount
 * is already derived, so every later add is a plain append with no conflict.
 */
export const hasDirectAmountConflict = (parent: CashflowItem): boolean =>
  (!parent.children || parent.children.length === 0) && parent.amount !== 0;

export class SubcategoryConflictError extends Error {
  constructor() {
    super(
      'Adding a subcategory to a category with a direct amount requires an ' +
        "explicit strategy ('preserve' or 'discard').",
    );
  }
}

/**
 * Default name for the child created by the 'preserve' strategy. Deliberately
 * not the parent's own name — a parent and child sharing a name is confusing
 * in a list and worse as a Sankey label once PR 1.5 renders it. The caller
 * (UI) is expected to let the user rename it at the point of choosing.
 */
const unallocatedChildName = (parentName: string) => `${parentName} (unallocated)`;

/**
 * Adds `child` to `parent.children`. If this is the first child and parent
 * holds a direct amount, `strategy` is required — there is no default, so a
 * caller can't silently pick one (R-DM-3). `parent.amount` is rolled up from
 * children afterward either way.
 */
export const addSubcategory = (
  parent: CashflowItem,
  child: CashflowSubItem,
  strategy?: SubcategoryConflictStrategy,
): CashflowItem => {
  const existingChildren = parent.children ?? [];

  if (existingChildren.length === 0 && hasDirectAmountConflict(parent)) {
    if (!strategy) throw new SubcategoryConflictError();

    const preserved: CashflowSubItem | null =
      strategy === 'preserve'
        ? {
            id: crypto.randomUUID(),
            name: unallocatedChildName(parent.name),
            amount: parent.amount,
            frequency: parent.frequency,
          }
        : null;

    const children = preserved ? [preserved, child] : [child];
    return withRolledUpAmount({ ...parent, children });
  }

  return withRolledUpAmount({ ...parent, children: [...existingChildren, child] });
};

/**
 * Removes a child by id. If it was the last child, the parent reverts to a
 * direct amount of 0 — not the last rollup value, which would invent a
 * "direct amount" the user never actually typed for the parent; and not a
 * block on removal, which no requirement calls for.
 */
export const removeSubcategory = (parent: CashflowItem, childId: string): CashflowItem => {
  const children = (parent.children ?? []).filter((child) => child.id !== childId);

  if (children.length === 0) {
    return { ...parent, amount: 0, children: undefined };
  }

  return withRolledUpAmount({ ...parent, children });
};

/**
 * Identifies the child a 'preserve' strategy just carried forward, so the UI
 * can open it for immediate rename (R-DM-3: "the user should be able to
 * rename the preserved child at the point of choosing"). Deliberately
 * doesn't assume the preserved child sits at a fixed index — it finds
 * whichever child isn't the one the caller just added. Returns null when
 * there's nothing to preserve (e.g. after a 'discard' add, where the added
 * child is the only one).
 */
export const preservedChildId = (parent: CashflowItem, addedChildId: string): string | null =>
  parent.children?.find((child) => child.id !== addedChildId)?.id ?? null;
