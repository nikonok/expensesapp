/* @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TransactionDayHeader from './TransactionDayHeader';

describe('TransactionDayHeader', () => {
  it('renders the day number from the date', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={0}
        totalExpense={0}
        currency="USD"
      />,
    );
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('renders the day label in EEE, dd.MM.yyyy format', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={0}
        totalExpense={0}
        currency="USD"
      />,
    );
    expect(screen.getByText('Mon, 13.04.2026')).toBeTruthy();
  });

  it('hides income amount when totalIncome is 0', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={0}
        totalExpense={5000}
        currency="USD"
      />,
    );
    // Income aria-label would be "income $X.XX" — should not be present
    expect(screen.queryByLabelText(/^income/)).toBeNull();
  });

  it('hides expense amount when totalExpense is 0', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={10000}
        totalExpense={0}
        currency="USD"
      />,
    );
    expect(screen.queryByLabelText(/^expense/)).toBeNull();
  });

  it('shows income amount when totalIncome > 0', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={10000}
        totalExpense={0}
        currency="USD"
      />,
    );
    expect(screen.getByLabelText('income $100.00')).toBeTruthy();
  });

  it('shows expense amount when totalExpense > 0', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={0}
        totalExpense={5000}
        currency="USD"
      />,
    );
    expect(screen.getByLabelText('expense $50.00')).toBeTruthy();
  });

  it('shows both income and expense when both are > 0', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={10000}
        totalExpense={5000}
        currency="USD"
      />,
    );
    expect(screen.getByLabelText('income $100.00')).toBeTruthy();
    expect(screen.getByLabelText('expense $50.00')).toBeTruthy();
  });

  it('hides both income and expense when both are 0', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={0}
        totalExpense={0}
        currency="USD"
      />,
    );
    expect(screen.queryByLabelText(/^income/)).toBeNull();
    expect(screen.queryByLabelText(/^expense/)).toBeNull();
  });

  it('renders amounts in the specified currency', () => {
    render(
      <TransactionDayHeader
        date="2026-04-13"
        totalIncome={20000}
        totalExpense={0}
        currency="EUR"
      />,
    );
    expect(screen.getByLabelText('income €200.00')).toBeTruthy();
  });

  it('renders correctly for a date at start of month', () => {
    render(
      <TransactionDayHeader
        date="2026-01-01"
        totalIncome={0}
        totalExpense={0}
        currency="USD"
      />,
    );
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Thu, 01.01.2026')).toBeTruthy();
  });

  it('renders correctly for a date at end of month', () => {
    render(
      <TransactionDayHeader
        date="2026-03-31"
        totalIncome={0}
        totalExpense={0}
        currency="USD"
      />,
    );
    expect(screen.getByText('31')).toBeTruthy();
    expect(screen.getByText('Tue, 31.03.2026')).toBeTruthy();
  });
});
