import React, { useState } from 'react';
import { CashflowItem, CashflowSubItem, Frequency } from '@/types/cashflow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, DollarSign, Pencil, Check, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, itemDisplayName, toAnnual, fromAnnual } from '@/utils/cashflowUtils';
import {
  hasDirectAmountConflict,
  addSubcategory,
  removeSubcategory,
  preservedChildId,
  SubcategoryConflictStrategy,
} from '@/utils/subcategoryUtils';
import { toast } from '@/hooks/use-toast';
import EmojiPicker from './EmojiPicker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

interface ExpenseSectionProps {
  expenses: CashflowItem[];
  onUpdateExpenses: (expenses: CashflowItem[]) => void;
  displayFrequency: Frequency;
}

const ExpenseSection: React.FC<ExpenseSectionProps> = ({ expenses, onUpdateExpenses, displayFrequency }) => {
  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseEmoji, setNewExpenseEmoji] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpensePeriod, setNewExpensePeriod] = useState<Frequency>('annual');
  const [editingExpense, setEditingExpense] = useState<CashflowItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editPeriod, setEditPeriod] = useState<Frequency>('annual');
  const isMobile = useIsMobile();

  // Subcategory management (edit-mode only, scoped to whichever expense is
  // currently being edited above).
  const [addingChild, setAddingChild] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [newChildAmount, setNewChildAmount] = useState('');
  const [newChildPeriod, setNewChildPeriod] = useState<Frequency>('annual');
  // Set when the entered child would be the first one added to a parent that
  // still holds a direct amount — addSubcategory refuses to guess, so the
  // add form is replaced with this explicit preserve/discard prompt instead
  // of failing silently (R-DM-3).
  const [conflictChild, setConflictChild] = useState<CashflowSubItem | null>(null);
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editChildName, setEditChildName] = useState('');
  const [editChildAmount, setEditChildAmount] = useState('');
  const [editChildPeriod, setEditChildPeriod] = useState<Frequency>('annual');

  const handleAddExpense = () => {
    if (!newExpenseName || !newExpenseAmount) return;

    const typedAmount = parseInt(newExpenseAmount.replace(/[^0-9]/g, ''));
    if (isNaN(typedAmount) || typedAmount <= 0) return;

    const newExpense: CashflowItem = {
      id: crypto.randomUUID(),
      name: newExpenseName,
      amount: toAnnual(typedAmount, newExpensePeriod),
      frequency: newExpensePeriod,
      ...(newExpenseEmoji ? { emoji: newExpenseEmoji } : {}),
    };

    onUpdateExpenses([...expenses, newExpense]);
    setNewExpenseName('');
    setNewExpenseEmoji('');
    setNewExpenseAmount('');
  };

  const handleDeleteExpense = (id: string) => {
    onUpdateExpenses(expenses.filter(expense => expense.id !== id));
  };

  const handleStartEdit = (expense: CashflowItem) => {
    setEditingExpense(expense);
    setEditName(expense.name);
    setEditEmoji(expense.emoji ?? '');
    // Seeded in the item's own entry frequency, not the global display
    // toggle — editing round-trips in the unit it was entered in.
    setEditAmount(Math.round(fromAnnual(expense.amount, expense.frequency)).toString());
    setEditPeriod(expense.frequency);
    resetChildForm();
  };

  const handleSaveEdit = () => {
    if (!editingExpense || !editName) return;

    const hasChildren = (editingExpense.children?.length ?? 0) > 0;

    // A parent with subcategories has a derived amount — the amount/period
    // inputs are hidden in that case, so there's nothing to read from them.
    if (hasChildren) {
      onUpdateExpenses(expenses.map(expense =>
        expense.id === editingExpense.id
          ? { ...expense, name: editName, emoji: editEmoji || undefined }
          : expense
      ));
      setEditingExpense(null);
      return;
    }

    if (!editAmount) return;
    const typedAmount = parseInt(editAmount.replace(/[^0-9]/g, ''));
    if (isNaN(typedAmount) || typedAmount <= 0) return;

    onUpdateExpenses(expenses.map(expense =>
      expense.id === editingExpense.id
        ? {
            ...expense,
            name: editName,
            amount: toAnnual(typedAmount, editPeriod),
            frequency: editPeriod,
            emoji: editEmoji || undefined,
          }
        : expense
    ));
    setEditingExpense(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleCancelEdit = () => {
    setEditingExpense(null);
    resetChildForm();
  };

  const resetChildForm = () => {
    setAddingChild(false);
    setNewChildName('');
    setNewChildAmount('');
    setNewChildPeriod('annual');
    setConflictChild(null);
    setEditingChildId(null);
  };

  // Applies a parent update produced by addSubcategory/removeSubcategory to
  // both the real list and the in-progress edit state, and — since removal
  // can revert the parent back to a direct amount of 0 — re-seeds the
  // amount/period inputs so they're correct if the user goes on to type a
  // direct amount for a now-childless parent.
  const applyParentUpdate = (updatedParent: CashflowItem) => {
    onUpdateExpenses(expenses.map(expense => (expense.id === updatedParent.id ? updatedParent : expense)));
    setEditingExpense(updatedParent);
    if (!updatedParent.children || updatedParent.children.length === 0) {
      setEditAmount(Math.round(fromAnnual(updatedParent.amount, updatedParent.frequency)).toString());
      setEditPeriod(updatedParent.frequency);
    }
  };

  const parseTypedAmount = (raw: string): number | null => {
    const typed = parseInt(raw.replace(/[^0-9]/g, ''));
    return isNaN(typed) || typed <= 0 ? null : typed;
  };

  const handleStartAddChild = () => {
    setAddingChild(true);
    setNewChildName('');
    setNewChildAmount('');
    setNewChildPeriod('annual');
    setConflictChild(null);
  };

  const handleCancelAddChild = () => {
    setAddingChild(false);
    setNewChildName('');
    setNewChildAmount('');
    setConflictChild(null);
  };

  const handleConfirmAddChild = () => {
    if (!editingExpense || !newChildName) return;
    const typedAmount = parseTypedAmount(newChildAmount);
    if (typedAmount === null) return;

    const child: CashflowSubItem = {
      id: crypto.randomUUID(),
      name: newChildName,
      amount: toAnnual(typedAmount, newChildPeriod),
      frequency: newChildPeriod,
    };

    if (hasDirectAmountConflict(editingExpense)) {
      // Don't add yet — the parent's existing direct amount needs an
      // explicit preserve/discard choice first (R-DM-3).
      setConflictChild(child);
      return;
    }

    applyParentUpdate(addSubcategory(editingExpense, child));
    handleCancelAddChild();
  };

  const handleResolveConflict = (strategy: SubcategoryConflictStrategy) => {
    if (!editingExpense || !conflictChild) return;

    const updatedParent = addSubcategory(editingExpense, conflictChild, strategy);
    applyParentUpdate(updatedParent);

    if (strategy === 'preserve') {
      const preservedId = preservedChildId(updatedParent, conflictChild.id);
      const preserved = updatedParent.children?.find((c) => c.id === preservedId);
      if (preserved) {
        setEditingChildId(preserved.id);
        setEditChildName(preserved.name);
        setEditChildAmount(Math.round(fromAnnual(preserved.amount, preserved.frequency)).toString());
        setEditChildPeriod(preserved.frequency);
      }
    }

    handleCancelAddChild();
  };

  const handleStartEditChild = (child: CashflowSubItem) => {
    setEditingChildId(child.id);
    setEditChildName(child.name);
    setEditChildAmount(Math.round(fromAnnual(child.amount, child.frequency)).toString());
    setEditChildPeriod(child.frequency);
  };

  const handleCancelEditChild = () => {
    setEditingChildId(null);
  };

  const handleSaveEditChild = () => {
    if (!editingExpense || !editingChildId || !editChildName) return;
    const typedAmount = parseTypedAmount(editChildAmount);
    if (typedAmount === null) return;

    const children = (editingExpense.children ?? []).map((c) =>
      c.id === editingChildId
        ? { ...c, name: editChildName, amount: toAnnual(typedAmount, editChildPeriod), frequency: editChildPeriod }
        : c
    );
    applyParentUpdate({ ...editingExpense, children, amount: children.reduce((sum, c) => sum + c.amount, 0) });
    setEditingChildId(null);
  };

  const handleRemoveChild = (childId: string) => {
    if (!editingExpense) return;
    const wasLastChild = (editingExpense.children?.length ?? 0) === 1;
    const parentName = itemDisplayName(editingExpense);

    applyParentUpdate(removeSubcategory(editingExpense, childId));
    if (editingChildId === childId) setEditingChildId(null);

    if (wasLastChild) {
      toast({
        title: `${parentName} now has no amount`,
        description: 'Add a subcategory or set a direct amount to give it one again.',
      });
    }
  };

  return (
    <Card className="shadow-soft animate-fade-in [animation-delay:100ms]">
      <CardHeader className="pb-3">
        <CardTitle className="text-xl font-medium text-expense flex items-center">
          Expenses
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">Tap an item to edit it.</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Existing expenses */}
          <div className="space-y-2">
          {expenses.map((expense) => (
            <div 
              key={expense.id} 
                className={cn(
                  "flex items-center justify-between p-3 bg-secondary/50 rounded-lg animate-slide-up cursor-pointer hover:bg-secondary/70 transition-colors",
                  editingExpense?.id === expense.id && "bg-secondary"
                )}
                onClick={() => !editingExpense && handleStartEdit(expense)}
              >
                {editingExpense?.id === expense.id ? (
                  <div className="w-full" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-start justify-between">
                    <div className="flex-1 mr-4">
                      <div className="mb-2 flex gap-2">
                        <EmojiPicker value={editEmoji} onChange={setEditEmoji} />
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className={cn(
                            "flex-1",
                            isMobile && "text-sm"
                          )}
                          onKeyDown={handleKeyDown}
                        />
                      </div>
                      {editingExpense.children && editingExpense.children.length > 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Total: {formatCurrency(fromAnnual(editingExpense.amount, displayFrequency))}/
                          {displayFrequency === 'monthly' ? 'month' : 'year'} — sum of{' '}
                          {editingExpense.children.length} subcategor{editingExpense.children.length === 1 ? 'y' : 'ies'}
                        </p>
                      ) : (
                      <div className="relative flex gap-2">
                        <div className="relative flex-1">
                          <DollarSign className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            type="number"
                            min="0"
                            step="100"
                            className={cn(
                              "pl-6 w-full no-spin",
                              isMobile && "text-sm"
                            )}
                            onKeyDown={handleKeyDown}
                          />
                        </div>
                        <Select
                          value={editPeriod}
                          onValueChange={(value) => setEditPeriod(value as Frequency)}
                        >
                          <SelectTrigger
                            className={cn("w-[90px] flex-shrink-0", isMobile && "text-sm")}
                          >
                            <SelectValue placeholder="Period" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="annual">Annual</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleSaveEdit}
                        className="h-8 w-8"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleCancelEdit}
                        className="h-8 w-8"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Subcategories</p>

                      {(editingExpense.children ?? []).map((child) => (
                        <div key={child.id} className="pl-3 border-l-2 border-border">
                          {editingChildId === child.id ? (
                            <div className="flex items-center gap-2 py-1">
                              <Input
                                value={editChildName}
                                onChange={(e) => setEditChildName(e.target.value)}
                                className="flex-1 h-8 text-sm"
                                autoFocus
                                onFocus={(e) => e.target.select()}
                              />
                              <div className="relative w-[90px] flex-shrink-0">
                                <DollarSign className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                <Input
                                  value={editChildAmount}
                                  onChange={(e) => setEditChildAmount(e.target.value)}
                                  type="number"
                                  min="0"
                                  step="100"
                                  className="pl-5 h-8 text-sm no-spin"
                                />
                              </div>
                              <Select value={editChildPeriod} onValueChange={(v) => setEditChildPeriod(v as Frequency)}>
                                <SelectTrigger className="w-[80px] h-8 text-sm flex-shrink-0">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="annual">Annual</SelectItem>
                                  <SelectItem value="monthly">Monthly</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={handleSaveEditChild}>
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={handleCancelEditChild}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between py-1">
                              <span className="text-sm">{child.name}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-sm text-muted-foreground">
                                  {formatCurrency(fromAnnual(child.amount, displayFrequency))}/
                                  {displayFrequency === 'monthly' ? 'mo' : 'yr'}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleStartEditChild(child)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveChild(child.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {conflictChild ? (
                        <div className="rounded-md bg-muted p-3 space-y-2 text-sm">
                          <p>
                            <strong>{itemDisplayName(editingExpense)}</strong> currently has a direct amount of{' '}
                            {formatCurrency(fromAnnual(editingExpense.amount, editingExpense.frequency))}/
                            {editingExpense.frequency === 'monthly' ? 'month' : 'year'}. Splitting it into
                            subcategories — what should happen to that amount?
                          </p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => handleResolveConflict('preserve')}>
                              Keep it as a subcategory
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleResolveConflict('discard')}>
                              Discard it
                            </Button>
                          </div>
                        </div>
                      ) : addingChild ? (
                        <div className="flex items-center gap-2 pl-3">
                          <Input
                            value={newChildName}
                            onChange={(e) => setNewChildName(e.target.value)}
                            placeholder="Subcategory name"
                            className="flex-1 h-8 text-sm"
                            autoFocus
                          />
                          <div className="relative w-[90px] flex-shrink-0">
                            <DollarSign className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input
                              value={newChildAmount}
                              onChange={(e) => setNewChildAmount(e.target.value)}
                              type="number"
                              min="0"
                              step="100"
                              className="pl-5 h-8 text-sm no-spin"
                            />
                          </div>
                          <Select value={newChildPeriod} onValueChange={(v) => setNewChildPeriod(v as Frequency)}>
                            <SelectTrigger className="w-[80px] h-8 text-sm flex-shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="annual">Annual</SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={handleConfirmAddChild}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={handleCancelAddChild}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-xs h-7 pl-3" onClick={handleStartAddChild}>
                          <Plus className="h-3 w-3 mr-1" /> Add subcategory
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
              <div className="flex-1 mr-4">
                <p className="font-medium">{itemDisplayName(expense)}</p>
                <p className="text-muted-foreground">
                  {expense.amount === 0 && !expense.children ? (
                    <span className="text-amber-600 dark:text-amber-500">No amount set</span>
                  ) : (
                    <>
                      {formatCurrency(fromAnnual(expense.amount, displayFrequency))}/
                      {displayFrequency === 'monthly' ? 'month' : 'year'}
                    </>
                  )}
                  {expense.children && expense.children.length > 0 ? (
                    <> · {expense.children.length} subcategor{expense.children.length === 1 ? 'y' : 'ies'}</>
                  ) : null}
                </p>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteExpense(expense.id);
                      }}
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
                  </>
                )}
            </div>
          ))}
          </div>
          
          {/* New expense input */}
          <div className="pt-2 space-y-3">
            <div className="flex gap-3">
              <EmojiPicker value={newExpenseEmoji} onChange={setNewExpenseEmoji} />
              <Input
                value={newExpenseName}
                onChange={(e) => setNewExpenseName(e.target.value)}
                placeholder="Expense name"
                className={cn(
                  "flex-1",
                  isMobile && "text-sm"
                )}
              />
              <div className="relative flex-shrink-0 w-[70px] md:w-[100px]">
                <DollarSign className="absolute left-2 md:left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={newExpenseAmount}
                  onChange={(e) => setNewExpenseAmount(e.target.value)}
                  type="number"
                  min="0"
                  step="100"
                  className={cn(
                    "pl-6 md:pl-8 w-full no-spin md:no-spin-none",
                    isMobile && "text-sm"
                  )}
                />
              </div>
              <Select
                value={newExpensePeriod}
                onValueChange={(value) => setNewExpensePeriod(value as Frequency)}
              >
                <SelectTrigger className={cn(
                  "w-[90px]",
                  isMobile && "text-sm"
                )}>
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={handleAddExpense} 
              className="w-full bg-expense hover:bg-expense/90"
            >
              <Plus className="h-4 w-4 mr-2" /> Add Expense
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ExpenseSection;
