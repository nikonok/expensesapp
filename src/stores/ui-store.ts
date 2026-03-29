import { create } from 'zustand';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import type { PeriodFilter, CategoryViewType } from '../types';

function defaultFilter(): PeriodFilter {
  const now = new Date();
  return {
    type: 'month',
    startDate: format(startOfMonth(now), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(now), 'yyyy-MM-dd'),
  };
}

function defaultBudgetMonth(): string {
  return format(new Date(), 'yyyy-MM');
}

interface UIStore {
  categoriesFilter: PeriodFilter;
  transactionsFilter: PeriodFilter;
  overviewFilter: PeriodFilter;
  budgetMonth: string;

  categoriesViewType: CategoryViewType;
  categoriesEditMode: boolean;

  transactionNoteFilter: string;
  transactionCategoryFilter: number | null;
  transactionAccountFilter: number | null;

  selectedTransactionIds: Set<number>;

  hasActiveTransactionFilters: () => boolean;

  setCategoriesFilter: (f: PeriodFilter) => void;
  setTransactionsFilter: (f: PeriodFilter) => void;
  setOverviewFilter: (f: PeriodFilter) => void;
  setBudgetMonth: (m: string) => void;
  toggleCategoriesViewType: () => void;
  setCategoriesViewType: (v: CategoryViewType) => void;
  setCategoriesEditMode: (on: boolean) => void;
  setTransactionNoteFilter: (note: string) => void;
  setTransactionCategoryFilter: (id: number | null) => void;
  setTransactionAccountFilter: (id: number | null) => void;
  clearTransactionFilters: () => void;
  toggleTransactionSelection: (id: number) => void;
  clearTransactionSelection: () => void;
  clearSelection: () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  categoriesFilter: defaultFilter(),
  transactionsFilter: defaultFilter(),
  overviewFilter: defaultFilter(),
  budgetMonth: defaultBudgetMonth(),

  categoriesViewType: 'EXPENSE',
  categoriesEditMode: false,

  transactionNoteFilter: '',
  transactionCategoryFilter: null,
  transactionAccountFilter: null,

  selectedTransactionIds: new Set<number>(),

  hasActiveTransactionFilters: () => {
    const s = get();
    return (
      s.transactionNoteFilter !== '' ||
      s.transactionCategoryFilter !== null ||
      s.transactionAccountFilter !== null
    );
  },

  setCategoriesFilter: (f) => set({ categoriesFilter: f }),
  setTransactionsFilter: (f) => set({ transactionsFilter: f }),
  setOverviewFilter: (f) => set({ overviewFilter: f }),
  setBudgetMonth: (m) => set({ budgetMonth: m }),

  toggleCategoriesViewType: () =>
    set((s) => ({
      categoriesViewType: s.categoriesViewType === 'EXPENSE' ? 'INCOME' : 'EXPENSE',
    })),
  setCategoriesViewType: (v) => set({ categoriesViewType: v }),
  setCategoriesEditMode: (on) => set({ categoriesEditMode: on }),

  setTransactionNoteFilter: (note) => set({ transactionNoteFilter: note }),
  setTransactionCategoryFilter: (id) => set({ transactionCategoryFilter: id }),
  setTransactionAccountFilter: (id) => set({ transactionAccountFilter: id }),

  clearTransactionFilters: () =>
    set({
      transactionNoteFilter: '',
      transactionCategoryFilter: null,
      transactionAccountFilter: null,
    }),

  toggleTransactionSelection: (id) =>
    set((s) => {
      const next = new Set(s.selectedTransactionIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedTransactionIds: next };
    }),

  clearTransactionSelection: () => set({ selectedTransactionIds: new Set<number>() }),
  clearSelection: () => set({ selectedTransactionIds: new Set<number>() }),
}));
