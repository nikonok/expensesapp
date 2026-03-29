import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';

import { useCategories } from '../../hooks/use-categories';
import { useTransactions } from '../../hooks/use-transactions';
import { useUIStore } from '../../stores/ui-store';
import { db } from '../../db/database';

import PeriodFilter from '../shared/PeriodFilter';
import { EmptyState } from '../shared/EmptyState';
import { ConfirmDialog } from '../shared/ConfirmDialog';

import DonutChart from './DonutChart';
import CategoryCard from './CategoryCard';
import CategoryForm from './CategoryForm';

import type { Category } from '../../db/models';
import { getUTCISOString, parsePeriodFilter } from '../../utils/date-utils';

export default function CategoryList() {
  const navigate = useNavigate();

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

  // Compute spent per category in period
  const spentByCategoryId = useMemo(() => {
    const map = new Map<number, number>();
    for (const tx of allTransactions) {
      if (tx.categoryId === null) continue;
      if (tx.type === 'EXPENSE' || tx.type === 'INCOME') {
        map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) + tx.amountMainCurrency);
      }
    }
    return map;
  }, [allTransactions]);

  // Totals for donut center
  const totalExpense = useMemo(
    () =>
      allTransactions
        .filter((t) => t.type === 'EXPENSE')
        .reduce((sum, t) => sum + t.amountMainCurrency, 0),
    [allTransactions],
  );

  const totalIncome = useMemo(
    () =>
      allTransactions
        .filter((t) => t.type === 'INCOME')
        .reduce((sum, t) => sum + t.amountMainCurrency, 0),
    [allTransactions],
  );

  // Donut slices — only current view type categories with nonzero spending
  const donutSlices = useMemo(() => {
    return categories
      .map((cat) => ({
        categoryId: cat.id!,
        color: cat.color,
        amount: spentByCategoryId.get(cat.id!) ?? 0,
      }))
      .filter((s) => s.amount > 0);
  }, [categories, spentByCategoryId]);

  async function handleRemoveCategory(id: number) {
    setConfirmTrash(id);
  }

  async function handleConfirmTrash() {
    if (confirmTrash === null) return;
    await db.categories.update(confirmTrash, {
      isTrashed: true,
      updatedAt: getUTCISOString(),
    });
    setConfirmTrash(null);
  }

  function handleCardClick(category: Category) {
    navigate(
      `/transactions/new?type=${category.type}&categoryId=${category.id}`,
    );
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

  const confirmCategory = confirmTrash !== null
    ? categories.find((c) => c.id === confirmTrash)
    : null;

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
              aria-label="View trash"
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
              <Trash2 size={20} strokeWidth={1.5} />
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
      {categories.length === 0 ? (
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
          {categories.map((cat) => {
            const budget = budgets.find((b) => b.categoryId === cat.id) ?? null;
            const spent = spentByCategoryId.get(cat.id!) ?? 0;

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
        title="Move to Trash?"
        body={`"${confirmCategory?.name ?? 'This category'}" will be moved to trash. Existing transactions will keep their category.`}
        confirmLabel="Move to Trash"
        variant="destructive"
        onConfirm={handleConfirmTrash}
        onCancel={() => setConfirmTrash(null)}
      />
    </div>
  );
}
