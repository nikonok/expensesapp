import { describe, it, expect } from 'vitest';
import {
  autoScaleChartBuckets,
  shiftPeriod,
  parsePeriodFilter,
  getWeekRange,
  formatDate,
} from '../date-utils';
import type { PeriodFilter } from '../../types';

describe('autoScaleChartBuckets', () => {
  it('returns hour for same-day range (0 days diff)', () => {
    const d = new Date(2026, 2, 15); // March 15
    expect(autoScaleChartBuckets(d, d)).toBe('hour');
  });

  it('returns day for 1-day range', () => {
    const start = new Date(2026, 2, 1);
    const end = new Date(2026, 2, 2);
    expect(autoScaleChartBuckets(start, end)).toBe('day');
  });

  it('returns day for 31-day range (boundary)', () => {
    const start = new Date(2026, 2, 1);
    const end = new Date(2026, 3, 1); // 31 days later
    expect(autoScaleChartBuckets(start, end)).toBe('day');
  });

  it('returns week for 32-day range (boundary)', () => {
    const start = new Date(2026, 2, 1);
    const end = new Date(2026, 3, 2); // 32 days later
    expect(autoScaleChartBuckets(start, end)).toBe('week');
  });

  it('returns week for 90-day range (boundary)', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 3, 1); // ~90 days
    expect(autoScaleChartBuckets(start, end)).toBe('week');
  });

  it('returns month for 91-day range (boundary)', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 3, 2); // 91 days
    expect(autoScaleChartBuckets(start, end)).toBe('month');
  });

  it('returns month for a full year range', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31);
    expect(autoScaleChartBuckets(start, end)).toBe('month');
  });
});

describe('shiftPeriod for month', () => {
  it('advances one month forward', () => {
    const filter: PeriodFilter = { type: 'month', startDate: '2026-03-15', endDate: '2026-03-15' };
    const result = shiftPeriod(filter, 1);
    expect(result.type).toBe('month');
    expect(result.startDate.startsWith('2026-04')).toBe(true);
  });

  it('retreats one month backward', () => {
    const filter: PeriodFilter = { type: 'month', startDate: '2026-03-15', endDate: '2026-03-15' };
    const result = shiftPeriod(filter, -1);
    expect(result.type).toBe('month');
    expect(result.startDate.startsWith('2026-02')).toBe(true);
  });

  it('handles year boundary when advancing', () => {
    const filter: PeriodFilter = { type: 'month', startDate: '2026-12-01', endDate: '2026-12-01' };
    const result = shiftPeriod(filter, 1);
    expect(result.startDate.startsWith('2027-01')).toBe(true);
  });
});

describe('shiftPeriod for week', () => {
  it('advances one week forward', () => {
    const filter: PeriodFilter = { type: 'week', startDate: '2026-03-16', endDate: '2026-03-16' };
    const result = shiftPeriod(filter, 1);
    expect(result.type).toBe('week');
    expect(result.startDate).toBe('2026-03-23');
  });

  it('retreats one week backward', () => {
    const filter: PeriodFilter = { type: 'week', startDate: '2026-03-16', endDate: '2026-03-16' };
    const result = shiftPeriod(filter, -1);
    expect(result.type).toBe('week');
    expect(result.startDate).toBe('2026-03-09');
  });
});

describe('shiftPeriod for day', () => {
  it('advances one day', () => {
    const filter: PeriodFilter = { type: 'day', startDate: '2026-03-15', endDate: '2026-03-15' };
    const result = shiftPeriod(filter, 1);
    expect(result.startDate).toBe('2026-03-16');
  });

  it('retreats one day', () => {
    const filter: PeriodFilter = { type: 'day', startDate: '2026-03-15', endDate: '2026-03-15' };
    const result = shiftPeriod(filter, -1);
    expect(result.startDate).toBe('2026-03-14');
  });
});

describe('shiftPeriod for year', () => {
  it('advances one year', () => {
    const filter: PeriodFilter = { type: 'year', startDate: '2026-06-01', endDate: '2026-06-01' };
    const result = shiftPeriod(filter, 1);
    expect(result.startDate.startsWith('2027')).toBe(true);
  });
});

describe('parsePeriodFilter', () => {
  it('all — covers Jan 1 2000 to Dec 31 2099', () => {
    const filter: PeriodFilter = { type: 'all', startDate: '', endDate: '' };
    const { start, end } = parsePeriodFilter(filter);
    expect(start.getFullYear()).toBe(2000);
    expect(end.getFullYear()).toBe(2099);
  });

  it('today — start and end are same day', () => {
    const filter: PeriodFilter = { type: 'today', startDate: '', endDate: '' };
    const { start, end } = parsePeriodFilter(filter);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('day — start and end are bounds of that day', () => {
    const filter: PeriodFilter = { type: 'day', startDate: '2026-03-15', endDate: '2026-03-15' };
    const { start, end } = parsePeriodFilter(filter);
    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
  });

  it('week — starts on Monday', () => {
    // March 16, 2026 is a Monday
    const filter: PeriodFilter = { type: 'week', startDate: '2026-03-18', endDate: '2026-03-18' };
    const { start, end } = parsePeriodFilter(filter);
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0); // Sunday
  });

  it('month — covers full month', () => {
    const filter: PeriodFilter = {
      type: 'month',
      startDate: '2026-03-15',
      endDate: '2026-03-15',
    };
    const { start, end } = parsePeriodFilter(filter);
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(31); // March has 31 days
  });

  it('year — Jan 1 to Dec 31', () => {
    const filter: PeriodFilter = { type: 'year', startDate: '2026-06-15', endDate: '2026-06-15' };
    const { start, end } = parsePeriodFilter(filter);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
  });

  it('custom — uses provided start and end dates', () => {
    const filter: PeriodFilter = {
      type: 'custom',
      startDate: '2026-01-10',
      endDate: '2026-02-20',
    };
    const { start, end } = parsePeriodFilter(filter);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(10);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(20);
  });
});

describe('formatDate', () => {
  it('formats YYYY-MM-DD as human readable', () => {
    expect(formatDate('2026-03-29')).toBe('29.03.2026');
  });

  it('formats single digit day correctly', () => {
    expect(formatDate('2026-01-05')).toBe('05.01.2026');
  });
});
