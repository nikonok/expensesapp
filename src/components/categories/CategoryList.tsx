import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Archive, Plus, Tag } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';

import { useCategories } from '../../hooks/use-categories';
import { useAccounts } from '../../hooks/use-accounts';
import { useTransactions } from '../../hooks/use-transactions';
import { useUIStore } from '../../stores/ui-store';
import { db } from '../../db/database';
import { isDebtPayment } from '../../utils/transaction-utils';

import PeriodFilter from '../shared/PeriodFilter';
import { EmptyState } from '../shared/EmptyState';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { useToast } from '../shared/Toast';

import DonutChart from './DonutChart';
import CategoryCard from './CategoryCard';
import CategoryForm from './CategoryForm';
import DebtPaymentCard from './DebtPaymentCard';

import type { Category, Account } from '../../db/models';
import { getUTCISOString, parsePeriodFilter } from '../../utils/date-utils';

export default function CategoryList() {
  const navigate = useNavigate();
  const { show: showToast } = useToast();

  const {
    categoriesFilter,
    setCategoriesFilter,
    categoriesViewType,
    categoriesEditMode,
    setCategoriesEditMode,
  } = useUIStore();

  const [formOpen, setFormOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | undefined>(undefined);
  const [confirmTrash, setConfirmTrash] = useState<number | null>(null);

  // Active categories for current view type
  const categories = useCategories(categoriesViewType, false);

  const allAccounts = useAccounts(true);

  // All transactions for the period (both expense and income) for the donut/totals
  const allTransactions = useTransactions({ filter: categoriesFilter });

  // Budget for current view month (derive month from filter start date)
  const budgetMonth = useMemo(() => {
    const { start } = parsePeriodFilter(categoriesFilter);
    return format(start, 'yyyy-MM');
  }, [categoriesFilter]);

  const budgets = useLiveQuery(
    () => db.budgets.where('month').equals(budgetMonth).toArray(),
    [budgetMonth],
  ) ?? [];

  // Compute spent per category and debt account payments in period
  const { expenseById, incomeById, debtAccountTotals } = useMemo(() => {
    const expenseById = new Map<number, number>();
    const incomeById = new Map<number, number>();
    const debtAccountTotals = new Map<number, number>();
    for (const tx of allTransactions) {
      if (isDebtPayment(tx) && tx.toAccountId != null) {
        debtAccountTotals.set(tx.toAccountId, (debtAccountTotals.get(tx.toAccountId) ?? 0) + tx.amountMainCurrency);
      } else if (tx.categoryId !== null) {
        if (tx.type === 'EXPENSE') {
          expenseById.set(tx.categoryId, (expenseById.get(tx.categoryId) ?? 0) + tx.amountMainCurrency);
        } else if (tx.type === 'INCOME') {
          incomeById.set(tx.categoryId, (incomeById.get(tx.categoryId) ?? 0) + tx.amountMainCurrency);
        }
      }
    }
    return { expenseById, incomeById, debtAccountTotals };
  }, [allTransactions]);

  const spentMap = categoriesViewType === 'EXPENSE' ? expenseById : incomeById;

  const debtAccountsWithSpend = useMemo(() => {
    if (categoriesViewType !== 'EXPENSE') return [];
    return allAccounts
      .filter((a) => a.type === 'DEBT' && (debtAccountTotals.get(a.id!) ?? 0) > 0)
      .sort((a, b) => (debtAccountTotals.get(b.id!) ?? 0) - (debtAccountTotals.get(a.id!) ?? 0));
  }, [allAccounts, debtAccountTotals, categoriesViewType]);

  // Totals for donut center — include debt payments so center matches ring area
  const totalExpense = useMemo(
    () =>
      allTransactions
        .filter((t) => (t.type === 'EXPENSE' && t.categoryId !== null) || isDebtPayment(t))
        .reduce((sum, t) => sum + t.amountMainCurrency, 0),
    [allTransactions],
  );

  const totalIncome = useMemo(
    () =>
      allTransactions
        .filter((t) => t.type === 'INCOME' && t.categoryId !== null)
        .reduce((sum, t) => sum + t.amountMainCurrency, 0),
    [allTransactions],
  );

  // Donut slices — current view type categories + debt account payments, nonzero only
  const donutSlices = useMemo(() => {
    const map = categoriesViewType === 'EXPENSE' ? expenseById : incomeById;
    const catSlices = categories
      .map((cat) => ({
        id: `cat-${cat.id!}`,
        color: cat.color,
        amount: map.get(cat.id!) ?? 0,
      }))
      .filter((s) => s.amount > 0);

    const debtSlices = debtAccountsWithSpend.map((acc) => ({
      id: `acc-${acc.id!}`,
      color: acc.color,
      amount: debtAccountTotals.get(acc.id!) ?? 0,
    }));

    return [...catSlices, ...debtSlices];
  }, [categories, expenseById, incomeById, categoriesViewType, debtAccountsWithSpend, debtAccountTotals]);

  async function handleRemoveCategory(id: number) {
    setConfirmTrash(id);
  }

  async function handleConfirmTrash() {
    if (confirmTrash === null) return;
    try {
      await db.categories.update(confirmTrash, {
        isTrashed: true,
        updatedAt: getUTCISOString(),
      });
      setConfirmTrash(null);
    } catch (err) {
      console.error('Failed to trash category:', err);
      showToast('Failed to archive category', 'error');
    }
  }

  function handleCardClick(category: Category) {
    navigate(
      `/transactions/new?type=${category.type}&categoryId=${category.id}`,
    );
  }

  function handleDebtCardClick(account: Account) {
    navigate(`/accounts/${account.id}`);
  }

  function handleEditCategory(category: Category) {
    setEditCategory(category);
    setFormOpen(true);
  }

  function handleAddCategory() {
    setEditCategory(undefined);
    setFormOpen(true);
  }

  function handleFormClose() {
    setFormOpen(false);
    setEditCategory(undefined);
  }

  // Drag sensors — distance:8 so taps still work
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(categories, oldIndex, newIndex);
    const updates = reordered.map((cat, index) => ({
      ...cat,
      displayOrder: index * 10,
    }));

    try {
      await db.categories.bulkPut(updates);
    } catch (err) {
      console.error('Failed to save category order:', err);
      showToast('Failed to save order', 'error');
    }
  }

  const confirmCategory = confirmTrash !== null
    ? categories.find((c) => c.id === confirmTrash)
    : null;

  const categoryIds = categories.map((c) => c.id!);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Controls row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          gap: 'var(--space-3)',
        }}
      >
        <PeriodFilter value={categoriesFilter} onChange={setCategoriesFilter} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* Trash icon (edit mode) */}
          {categoriesEditMode && (
            <button
              onClick={() => navigate('/categories/trash')}
              aria-label="View archived categories"
              style={{
                minWidth: '44px',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
              }}
            >
              <Archive size={20} strokeWidth={1.5} />
            </button>
          )}

          {/* Edit/Done button */}
          <button
            onClick={() => setCategoriesEditMode(!categoriesEditMode)}
            style={{
              minHeight: '36px',
              padding: '0 var(--space-3)',
              background: categoriesEditMode ? 'var(--color-primary-dim)' : 'var(--color-surface)',
              border: `1px solid ${categoriesEditMode ? 'var(--color-primary)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-chip)',
              cursor: 'pointer',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              color: categoriesEditMode ? 'var(--color-primary)' : 'var(--color-text)',
              transition: 'background 100ms ease-out, border-color 100ms ease-out, color 100ms ease-out',
            }}
          >
            {categoriesEditMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Donut chart */}
      <DonutChart
        slices={donutSlices}
        totalExpense={totalExpense}
        totalIncome={totalIncome}
        categoriesViewType={categoriesViewType}
      />

      {/* View type label */}
      <div
        style={{
          paddingInline: 'var(--space-4)',
          paddingBottom: 'var(--space-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {categoriesViewType === 'EXPENSE' ? 'Expenses' : 'Income'}
        </span>

        {/* Add button (edit mode) */}
        {categoriesEditMode && (
          <button
            onClick={handleAddCategory}
            aria-label={`Add ${categoriesViewType === 'EXPENSE' ? 'expense' : 'income'} category`}
            style={{
              minWidth: '44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-primary)',
              border: 'none',
              borderRadius: '50%',
              cursor: 'pointer',
              color: 'var(--color-bg)',
            }}
          >
            <Plus size={20} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Category cards */}
      {categories.length === 0 && debtAccountsWithSpend.length === 0 ? (
        <EmptyState
          icon={Tag}
          heading="No categories yet"
          body={`Add ${categoriesViewType === 'EXPENSE' ? 'expense' : 'income'} categories to track your spending.`}
          action={
            categoriesEditMode
              ? { label: 'Add Category', onClick: handleAddCategory }
              : undefined
          }
        />
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            padding: '0 var(--space-4) var(--space-4)',
          }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
              {categories.map((cat) => {
                const budget = budgets.find((b) => b.categoryId === cat.id) ?? null;
                const spent = spentMap.get(cat.id!) ?? 0;

                return (
                  <CategoryCard
                    key={cat.id}
                    category={cat}
                    spent={spent}
                    budget={budget?.plannedAmount ?? null}
                    editMode={categoriesEditMode}
                    onRemove={handleRemoveCategory}
                    onClick={categoriesEditMode ? handleEditCategory : handleCardClick}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
          {debtAccountsWithSpend.map((acc) => {
            const budget = budgets.find((b) => b.accountId === acc.id) ?? null;
            return (
              <DebtPaymentCard
                key={`debt-${acc.id!}`}
                account={acc}
                spent={debtAccountTotals.get(acc.id!) ?? 0}
                budget={budget?.plannedAmount ?? null}
                onClick={handleDebtCardClick}
              />
            );
          })}
        </div>
      )}

      {/* Category form (add/edit) */}
      <CategoryForm
        isOpen={formOpen}
        onClose={handleFormClose}
        editCategory={editCategory}
        defaultType={categoriesViewType}
      />

      {/* Confirm trash dialog */}
      <ConfirmDialog
        isOpen={confirmTrash !== null}
        title="Archive Category?"
        body={`"${confirmCategory?.name ?? 'This category'}" will be archived. Existing transactions will keep their category.`}
        confirmLabel="Archive"
        variant="destructive"
        onConfirm={handleConfirmTrash}
        onCancel={() => setConfirmTrash(null)}
      />
    </div>
  );
}
