import { useState } from 'react';
import { Numpad } from '../shared/Numpad';
import BottomSheet from '../layout/BottomSheet';
import { BudgetStats } from './BudgetStats';
import { NumpadDisplay } from '../shared/NumpadDisplay';
import { db } from '../../db/database';
import { getUTCISOString } from '../../utils/date-utils';
import { budgetSchema } from '../../utils/validation';
import { useToast } from '../shared/Toast';

interface BudgetNumpadProps {
  categoryId?: number;
  accountId?: number;
  currentMonth: string; // "YYYY-MM"
  currentPlanned?: number;
  itemName: string;
  currency?: string;
  onClose: () => void;
}

export function BudgetNumpad({
  categoryId,
  accountId,
  currentMonth,
  currentPlanned,
  itemName,
  currency,
  onClose,
}: BudgetNumpadProps) {
  const [value, setValue] = useState(
    currentPlanned != null && currentPlanned > 0 ? String(currentPlanned / 100) : '',
  );
  const [statsOpen, setStatsOpen] = useState(false);
  const { show } = useToast();

  const handleSave = async (result: number) => {
    const parseResult = budgetSchema.safeParse({
      categoryId: categoryId ?? null,
      accountId: accountId ?? null,
      month: currentMonth,
      plannedAmount: result,
    });
    if (!parseResult.success) {
      return;
    }

    try {
      const now = getUTCISOString();

      // Find existing budget record for this month + category/account
      let existing;
      if (categoryId != null) {
        existing = await db.budgets
          .where('[categoryId+month]')
          .equals([categoryId, currentMonth])
          .first();
      } else if (accountId != null) {
        existing = await db.budgets
          .where('[accountId+month]')
          .equals([accountId, currentMonth])
          .first();
      }

      if (existing) {
        await db.budgets.update(existing.id!, {
          plannedAmount: result,
          updatedAt: now,
        });
      } else {
        await db.budgets.add({
          categoryId: categoryId ?? null,
          accountId: accountId ?? null,
          month: currentMonth,
          plannedAmount: result,
          createdAt: now,
          updatedAt: now,
        });
      }

      onClose();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to save budget:', err);
      show('Failed to save budget', 'error');
    }
  };

  return (
    <>
      {/* Numpad header */}
      <div
        style={{
          padding: 'var(--space-4) var(--space-4) 0',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {itemName}
        </span>
        {/* Display */}
        <NumpadDisplay
          value={value}
          isActive={true}
          align="center"
          style={{ minHeight: '3rem', padding: 'var(--space-2) 0' }}
        />
      </div>

      <Numpad
        value={value}
        onChange={setValue}
        onSave={handleSave}
        variant="budget"
        onStatsPress={() => setStatsOpen(true)}
        currencyCode={currency}
      />

      <BottomSheet
        isOpen={statsOpen}
        onClose={() => setStatsOpen(false)}
        title="Budget stats"
      >
        <BudgetStats
          categoryId={categoryId}
          accountId={accountId}
          month={currentMonth}
        />
      </BottomSheet>
    </>
  );
}
