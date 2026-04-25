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

  showInstallPrompt: boolean;
  showOnboardingCompletePopup: boolean;

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
  setCategoriesEditMode: (on: boolean) => void;
  setShowInstallPrompt: (v: boolean) => void;
  setShowOnboardingCompletePopup: (v: boolean) => void;
  setTransactionNoteFilter: (note: string) => void;
  setTransactionCategoryFilter: (id: number | null) => void;
  setTransactionAccountFilter: (id: number | null) => void;
  clearTransactionFilters: () => void;
  resetTransactionsFilter: () => void;
  toggleTransactionSelection: (id: number) => void;
  clearSelection: () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  categoriesFilter: defaultFilter(),
  transactionsFilter: defaultFilter(),
  overviewFilter: defaultFilter(),
  budgetMonth: defaultBudgetMonth(),

  categoriesViewType: 'EXPENSE',
  categoriesEditMode: false,

  showInstallPrompt: false,
  showOnboardingCompletePopup: false,

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
  setCategoriesEditMode: (on) => set({ categoriesEditMode: on }),
  setShowInstallPrompt: (v) => set({ showInstallPrompt: v }),
  setShowOnboardingCompletePopup: (v) => set({ showOnboardingCompletePopup: v }),

  setTransactionNoteFilter: (note) => set({ transactionNoteFilter: note }),
  setTransactionCategoryFilter: (id) => set({ transactionCategoryFilter: id }),
  setTransactionAccountFilter: (id) => set({ transactionAccountFilter: id }),

  clearTransactionFilters: () =>
    set({
      transactionNoteFilter: '',
      transactionCategoryFilter: null,
      transactionAccountFilter: null,
    }),

  resetTransactionsFilter: () =>
    set({
      transactionsFilter: defaultFilter(),
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

  clearSelection: () => set({ selectedTransactionIds: new Set<number>() }),
}));
