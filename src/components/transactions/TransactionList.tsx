import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Plus, SlidersHorizontal, ArrowLeftRight } from 'lucide-react';
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
import { useTransactions } from '../../hooks/use-transactions';
import { useAccounts } from '../../hooks/use-accounts';
import { useCategories } from '../../hooks/use-categories';
import { useUIStore } from '../../stores/ui-store';
import type { Transaction, Account, Category } from '../../db/models';
import { revertTransaction, revertTransfer } from '../../services/balance.service';
import { db } from '../../db/database';
import PeriodFilter from '../shared/PeriodFilter';
import { EmptyState } from '../shared/EmptyState';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import TransactionDayHeader from './TransactionDayHeader';
import TransactionRow from './TransactionRow';
import TransactionFilters from './TransactionFilters';
import SelectionToolbar from './SelectionToolbar';

export default function TransactionList() {
  const navigate = useNavigate();

  const {
    transactionsFilter,
    setTransactionsFilter,
    transactionNoteFilter,
    transactionCategoryFilter,
    transactionAccountFilter,
    hasActiveTransactionFilters,
    clearTransactionFilters,
    selectedTransactionIds,
    toggleTransactionSelection,
    clearSelection,
  } = useUIStore();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const transactions = useTransactions({
    filter: transactionsFilter,
    accountId: transactionAccountFilter ?? undefined,
    categoryId: transactionCategoryFilter ?? undefined,
    noteContains: transactionNoteFilter,
  });

  const allAccounts = useAccounts(true);
  const allCategories = useCategories(undefined, true);

  const accountMap = useMemo(() => {
    const m = new Map<number, Account>();
    for (const a of allAccounts) {
      if (a.id !== undefined) m.set(a.id, a);
    }
    return m;
  }, [allAccounts]);

  const categoryMap = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of allCategories) {
      if (c.id !== undefined) m.set(c.id, c);
    }
    return m;
  }, [allCategories]);

  // Group transactions by date, collapsing transfer pairs into a single visible row
  const { groupedByDate, txById } = useMemo(() => {
    const txById = new Map<number, Transaction>();
    for (const t of transactions) {
      if (t.id !== undefined) txById.set(t.id, t);
    }

    const activeFilters = hasActiveTransactionFilters();

    // Build display rows: in unfiltered view, merge transfer pairs
    // In filtered view, show all individual records
    let displayTxs: Transaction[];
    if (!activeFilters) {
      const seenGroups = new Set<string>();
      displayTxs = [];
      for (const t of transactions) {
        if (t.type === 'TRANSFER' && t.transferGroupId) {
          if (seenGroups.has(t.transferGroupId)) continue;
          seenGroups.add(t.transferGroupId);
          // Show OUT side as the representative row
          if (t.transferDirection === 'IN') {
            // Check if OUT side exists in this list
            const outSide = transactions.find(
              (x) =>
                x.transferGroupId === t.transferGroupId && x.transferDirection === 'OUT',
            );
            if (outSide) {
              displayTxs.push(outSide);
            } else {
              displayTxs.push(t);
            }
          } else {
            displayTxs.push(t);
          }
        } else {
          displayTxs.push(t);
        }
      }
    } else {
      displayTxs = transactions;
    }

    // Group by date
    const groups = new Map<string, Transaction[]>();
    for (const t of displayTxs) {
      const existing = groups.get(t.date) ?? [];
      existing.push(t);
      groups.set(t.date, existing);
    }

    // Sort dates descending
    const sortedDates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

    return {
      groupedByDate: sortedDates.map((date) => ({
        date,
        txs: groups.get(date)!,
      })),
      txById,
    };
  }, [transactions, transactionNoteFilter, transactionCategoryFilter, transactionAccountFilter]);

  // Compute day totals (income/expense) per day
  function getDayTotals(txs: Transaction[]): { income: number; expense: number } {
    let income = 0;
    let expense = 0;
    for (const t of txs) {
      if (t.type === 'INCOME') income += t.amount;
      else if (t.type === 'EXPENSE') expense += t.amount;
    }
    return { income, expense };
  }

  // Get the currency for a transaction's account
  function getCurrency(tx: Transaction): string {
    return accountMap.get(tx.accountId)?.currency ?? 'USD';
  }

  // Find the partner side of a transfer
  function getTransferToAccount(tx: Transaction): Account | undefined {
    if (!tx.transferGroupId) return undefined;
    const partner = transactions.find(
      (t) =>
        t.transferGroupId === tx.transferGroupId &&
        t.transferDirection !== tx.transferDirection,
    );
    if (!partner) return undefined;
    return accountMap.get(partner.accountId);
  }

  // Selection handlers
  function handleSelect(tx: Transaction) {
    if (tx.id === undefined) return;
    if (tx.type === 'TRANSFER' && tx.transferGroupId) {
      // Select/deselect both legs of the transfer
      const partnerTx = transactions.find(
        (t) =>
          t.transferGroupId === tx.transferGroupId &&
          t.id !== tx.id,
      );
      toggleTransactionSelection(tx.id);
      if (partnerTx?.id !== undefined) {
        toggleTransactionSelection(partnerTx.id);
      }
    } else {
      toggleTransactionSelection(tx.id);
    }
  }

  function isRowSelected(tx: Transaction): boolean {
    if (tx.id === undefined) return false;
    return selectedTransactionIds.has(tx.id);
  }

  // Remove handler
  async function handleConfirmRemove() {
    setConfirmOpen(false);
    const processedGroups = new Set<string>();
    for (const id of selectedTransactionIds) {
      const tx = txById.get(id);
      if (!tx) continue;
      if (tx.type === 'TRANSFER' && tx.transferGroupId) {
        if (processedGroups.has(tx.transferGroupId)) continue;
        processedGroups.add(tx.transferGroupId);
        try {
          await revertTransfer(tx.transferGroupId);
        } catch (err) {
          console.error('Failed to revert transfer', err);
        }
      } else {
        try {
          await revertTransaction(tx);
        } catch (err) {
          console.error('Failed to revert transaction', err);
        }
      }
    }
    clearSelection();
  }

  // Edit handler — single selection only
  function handleEdit() {
    const [id] = Array.from(selectedTransactionIds);
    if (id === undefined) return;
    const tx = txById.get(id);
    if (!tx) return;
    // Navigate to the transaction's actual id (for transfers, use the OUT leg)
    let editId = id;
    if (tx.type === 'TRANSFER' && tx.transferGroupId) {
      const outTx = transactions.find(
        (t) =>
          t.transferGroupId === tx.transferGroupId && t.transferDirection === 'OUT',
      );
      if (outTx?.id !== undefined) editId = outTx.id;
    }
    clearSelection();
    navigate(`/transactions/${editId}/edit`);
  }

  // The main currency for the day header — use first tx's account currency
  function getDayCurrency(txs: Transaction[]): string {
    for (const t of txs) {
      const cur = getCurrency(t);
      if (cur) return cur;
    }
    return 'USD';
  }

  // Drag sensors — distance:8 so taps still register as selection
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // Handle drag end for a specific day group
  async function handleDragEnd(event: DragEndEvent, dayTxs: Transaction[]) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = dayTxs.findIndex((t) => t.id === active.id);
    const newIndex = dayTxs.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(dayTxs, oldIndex, newIndex);
    const updates = reordered.map((tx, index) => ({
      ...tx,
      displayOrder: index * 10,
    }));

    await db.transactions.bulkPut(updates);
  }

  const hasFilters = hasActiveTransactionFilters();
  const isEmpty = groupedByDate.length === 0;
  const selectionCount = selectedTransactionIds.size;

  return (
    <>
      {/* Filter row */}
      <div
        style={{
          position: 'sticky',
          top: '56px',
          zIndex: 'var(--z-sticky)',
          background: 'var(--color-bg)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          paddingInline: 'var(--space-4)',
          paddingBlock: 'var(--space-2)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ flex: 1 }}>
          <PeriodFilter value={transactionsFilter} onChange={setTransactionsFilter} />
        </div>
        <button
          aria-label="Open filters"
          onClick={() => setFiltersOpen(true)}
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: hasFilters ? 'var(--color-primary-dim)' : 'var(--color-surface)',
            border: `1px solid ${hasFilters ? 'var(--color-primary)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-chip)',
            cursor: 'pointer',
            color: hasFilters ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            flexShrink: 0,
            transition: 'background 100ms ease-out, border-color 100ms ease-out',
          }}
        >
          <SlidersHorizontal size={18} strokeWidth={1.5} />
        </button>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            paddingInline: 'var(--space-4)',
            paddingBlock: 'var(--space-2)',
          }}
        >
          <button
            onClick={clearTransactionFilters}
            style={{
              height: '32px',
              padding: '0 var(--space-3)',
              background: 'var(--color-expense-dim)',
              border: '1px solid oklch(62% 0.28 18 / 30%)',
              borderRadius: 'var(--radius-chip)',
              color: 'var(--color-expense)',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-caption)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Transaction list */}
      {isEmpty ? (
        <EmptyState
          icon={ArrowLeftRight}
          heading="No transactions"
          body={hasFilters ? 'Try adjusting your filters.' : 'Tap + to add your first transaction.'}
          action={
            !hasFilters
              ? { label: 'Add transaction', onClick: () => navigate('/transactions/new') }
              : undefined
          }
        />
      ) : (
        <div style={{ paddingBottom: selectionCount > 0 ? 'calc(56px + env(safe-area-inset-bottom) + 16px)' : 'var(--space-4)' }}>
          {groupedByDate.map(({ date, txs }) => {
            const { income, expense } = getDayTotals(txs);
            const dayCurrency = getDayCurrency(txs);
            const dayTxIds = txs.map((t) => t.id!);
            return (
              <div key={date} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' } as React.CSSProperties}>
                <TransactionDayHeader
                  date={date}
                  totalIncome={income}
                  totalExpense={expense}
                  currency={dayCurrency}
                />
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => handleDragEnd(event, txs)}
                >
                  <SortableContext items={dayTxIds} strategy={verticalListSortingStrategy}>
                    {txs.map((tx) => {
                      const account = accountMap.get(tx.accountId);
                      if (!account) return null;
                      const category =
                        tx.categoryId !== null ? (categoryMap.get(tx.categoryId) ?? null) : null;
                      const toAccount = getTransferToAccount(tx);
                      return (
                        <TransactionRow
                          key={tx.id}
                          transaction={tx}
                          account={account}
                          toAccount={toAccount}
                          category={category}
                          isSelected={isRowSelected(tx)}
                          onSelect={() => handleSelect(tx)}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>
              </div>
            );
          })}
        </div>
      )}

      {/* FAB */}
      <button
        aria-label="Add transaction"
        onClick={() => navigate('/transactions/new')}
        style={{
          position: 'fixed',
          bottom: `calc(var(--nav-height) + var(--space-4))`,
          right: 'var(--space-4)',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'var(--color-primary)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 'var(--z-fab)',
          boxShadow: '0 0 16px oklch(72% 0.22 210 / 50%)',
          transition: 'transform 80ms ease-out, box-shadow 80ms ease-out',
          color: 'var(--color-bg)',
        }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.93)';
        }}
        onPointerUp={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = '';
        }}
        onPointerLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = '';
        }}
      >
        <Plus size={24} strokeWidth={2} />
      </button>

      {/* Filters sheet */}
      <TransactionFilters isOpen={filtersOpen} onClose={() => setFiltersOpen(false)} />

      {/* Selection toolbar */}
      {selectionCount > 0 && (
        <SelectionToolbar
          selectedIds={selectedTransactionIds}
          onEdit={handleEdit}
          onRemove={() => setConfirmOpen(true)}
          onClear={clearSelection}
        />
      )}

      {/* Confirm delete dialog */}
      <ConfirmDialog
        isOpen={confirmOpen}
        title="Remove transactions"
        body={`Remove ${selectionCount} transaction${selectionCount !== 1 ? 's' : ''}? This cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={handleConfirmRemove}
        onCancel={() => setConfirmOpen(false)}
        variant="destructive"
      />
    </>
  );
}
