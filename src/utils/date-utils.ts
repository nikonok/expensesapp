import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  parseISO,
} from 'date-fns';
import type { PeriodFilter, PeriodFilterType } from '../types';

export function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getUTCISOString(): string {
  return new Date().toISOString();
}

export function parsePeriodFilter(filter: PeriodFilter): { start: Date; end: Date } {
  switch (filter.type) {
    case 'all':
      return {
        start: new Date(2000, 0, 1),
        end: new Date(2099, 11, 31, 23, 59, 59, 999),
      };

    case 'today': {
      const now = new Date();
      return {
        start: startOfDay(now),
        end: endOfDay(now),
      };
    }

    case 'day': {
      const d = parseISO(filter.startDate);
      return {
        start: startOfDay(d),
        end: endOfDay(d),
      };
    }

    case 'week': {
      const d = parseISO(filter.startDate);
      return {
        start: startOfWeek(d, { weekStartsOn: 1 }),
        end: endOfWeek(d, { weekStartsOn: 1 }),
      };
    }

    case 'month': {
      const d = parseISO(filter.startDate);
      return {
        start: startOfMonth(d),
        end: endOfMonth(d),
      };
    }

    case 'year': {
      const d = parseISO(filter.startDate);
      return {
        start: startOfYear(d),
        end: endOfYear(d),
      };
    }

    case 'custom': {
      return {
        start: startOfDay(parseISO(filter.startDate)),
        end: endOfDay(parseISO(filter.endDate)),
      };
    }
  }
}

export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'dd.MM.yyyy');
}

export function getWeekRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 }),
  };
}

export function getMonthRange(date: Date): { start: Date; end: Date } {
  return {
    start: startOfMonth(date),
    end: endOfMonth(date),
  };
}

export function getPeriodLabel(filter: PeriodFilter): string {
  const today = new Date();

  switch (filter.type) {
    case 'all':
      return 'All time';

    case 'today':
      return 'Today';

    case 'day': {
      const d = parseISO(filter.startDate);
      const todayStr = getLocalDateString();
      if (filter.startDate === todayStr) return 'Today';
      return format(d, 'dd.MM.yyyy');
    }

    case 'week': {
      const d = parseISO(filter.startDate);
      const { start } = getWeekRange(today);
      const thisWeekStart = format(start, 'yyyy-MM-dd');
      const filterWeekStart = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      if (thisWeekStart === filterWeekStart) return 'This week';
      const weekStart = startOfWeek(d, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(d, { weekStartsOn: 1 });
      return `${format(weekStart, 'dd.MM')} – ${format(weekEnd, 'dd.MM.yyyy')}`;
    }

    case 'month': {
      const d = parseISO(filter.startDate);
      const thisMonthStr = format(today, 'yyyy-MM');
      const filterMonthStr = format(d, 'yyyy-MM');
      if (thisMonthStr === filterMonthStr) return format(d, 'MMMM yyyy');
      return format(d, 'MMMM yyyy');
    }

    case 'year': {
      const d = parseISO(filter.startDate);
      return format(d, 'yyyy');
    }

    case 'custom': {
      const start = parseISO(filter.startDate);
      const end = parseISO(filter.endDate);
      return `${format(start, 'dd.MM')} – ${format(end, 'dd.MM.yyyy')}`;
    }
  }
}

export function autoScaleChartBuckets(
  start: Date,
  end: Date,
): 'hour' | 'day' | 'week' | 'month' {
  const startDay = startOfDay(start);
  const endDay = startOfDay(end);
  const diffMs = endDay.getTime() - startDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'hour';
  if (diffDays <= 31) return 'day';
  if (diffDays <= 90) return 'week';
  return 'month';
}

export function shiftPeriod(filter: PeriodFilter, direction: 1 | -1): PeriodFilter {
  switch (filter.type) {
    case 'today': {
      const now = new Date();
      const shifted = addDays(now, direction);
      const dateStr = format(shifted, 'yyyy-MM-dd');
      return { type: 'day', startDate: dateStr, endDate: dateStr };
    }

    case 'day': {
      const d = parseISO(filter.startDate);
      const shifted = addDays(d, direction);
      const dateStr = format(shifted, 'yyyy-MM-dd');
      return { type: 'day', startDate: dateStr, endDate: dateStr };
    }

    case 'week': {
      const d = parseISO(filter.startDate);
      const shifted = addWeeks(d, direction);
      const dateStr = format(shifted, 'yyyy-MM-dd');
      return { type: 'week', startDate: dateStr, endDate: dateStr };
    }

    case 'month': {
      const d = parseISO(filter.startDate);
      const shifted = addMonths(d, direction);
      const dateStr = format(shifted, 'yyyy-MM-dd');
      return { type: 'month', startDate: dateStr, endDate: dateStr };
    }

    case 'year': {
      const d = parseISO(filter.startDate);
      const shifted = addYears(d, direction);
      const dateStr = format(shifted, 'yyyy-MM-dd');
      return { type: 'year', startDate: dateStr, endDate: dateStr };
    }

    default:
      return filter;
  }
}
