export type PeriodFilterType = "all" | "today" | "custom" | "day" | "week" | "month" | "year";

export interface PeriodFilter {
  type: PeriodFilterType;
  startDate: string;
  endDate: string;
}

export type TabName = "accounts" | "categories" | "transactions" | "budget" | "overview";

export type CategoryViewType = "EXPENSE" | "INCOME";
