
import React, { useState } from 'react';
import { CashflowItem, Frequency } from '../types/cashflow';
import { cn } from '@/lib/utils';
import IncomeSection from './cashflow/IncomeSection';
import ExpenseSection from './cashflow/ExpenseSection';
import CashflowSummary from './cashflow/CashflowSummary';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CashflowFormProps {
  incomes: CashflowItem[];
  expenses: CashflowItem[];
  onUpdateIncomes: (incomes: CashflowItem[]) => void;
  onUpdateExpenses: (expenses: CashflowItem[]) => void;
  className?: string;
}

const CashflowForm: React.FC<CashflowFormProps> = ({
  incomes,
  expenses,
  onUpdateIncomes,
  onUpdateExpenses,
  className,
}) => {
  // View state only (R-DM-5 pattern): never written to CashflowState, the
  // URL, or localStorage. Resets to 'annual' on reload. Changing it only
  // feeds display-time conversions in the children below — it never touches
  // incomes/expenses, so it can't mutate stored amounts.
  const [displayFrequency, setDisplayFrequency] = useState<Frequency>('annual');

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">Show amounts as</span>
        <Select
          value={displayFrequency}
          onValueChange={(value) => setDisplayFrequency(value as Frequency)}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Display" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annual">Annual</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Income Section */}
        <IncomeSection
          incomes={incomes}
          onUpdateIncomes={onUpdateIncomes}
          displayFrequency={displayFrequency}
        />

        {/* Expense Section */}
        <ExpenseSection
          expenses={expenses}
          onUpdateExpenses={onUpdateExpenses}
          displayFrequency={displayFrequency}
        />

        {/* Total Summary */}
        <CashflowSummary
          incomes={incomes}
          expenses={expenses}
          displayFrequency={displayFrequency}
        />
      </div>
    </div>
  );
};

export default CashflowForm;
