/* @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/IconPicker', () => ({
  getLucideIcon: () => null,
}));

import DebtPaymentCard from './DebtPaymentCard';
import type { Account } from '../../db/models';

function makeDebtAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: 'Car Loan',
    type: 'DEBT',
    color: 'oklch(72% 0.22 210)',
    icon: '',
    currency: 'USD',
    description: '',
    balance: -3000,
    startingBalance: 0,
    includeInTotal: true,
    isTrashed: false,
    debtOriginalAmount: 5000,
    interestRateYearly: null,
    interestRateMonthly: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DebtPaymentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the account name', () => {
    render(<DebtPaymentCard account={makeDebtAccount({ name: 'Home Mortgage' })} spent={500} budget={null} />);
    expect(screen.getByText('Home Mortgage')).toBeTruthy();
  });

  it('renders the spent amount with "Paid:" label', () => {
    render(<DebtPaymentCard account={makeDebtAccount()} spent={123456} budget={null} />);
    expect(screen.getByText('Paid: 1234.56')).toBeTruthy();
  });

  it('does not show the budget progress bar when budget is null', () => {
    const { container } = render(
      <DebtPaymentCard account={makeDebtAccount()} spent={200} budget={null} />,
    );
    // The progress bar track is a div with height 4px at the bottom — only rendered when budget != null.
    // We look for the inner fill div by its inline transition style as a distinguishing attribute.
    const progressBars = container.querySelectorAll('[style*="transition: width"]');
    expect(progressBars.length).toBe(0);
  });

  it('shows the budget progress bar when budget is provided', () => {
    const { container } = render(
      <DebtPaymentCard account={makeDebtAccount()} spent={200} budget={500} />,
    );
    const progressBars = container.querySelectorAll('[style*="transition: width"]');
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it('applies over-budget background when spent exceeds budget', () => {
    const { container } = render(
      <DebtPaymentCard account={makeDebtAccount()} spent={600} budget={500} />,
    );
    // The root card div should use the expense-dim background
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.background).toBe('var(--color-expense-dim)');
  });

  it('does not apply over-budget background when spent is within budget', () => {
    const { container } = render(
      <DebtPaymentCard account={makeDebtAccount()} spent={300} budget={500} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.background).toBe('var(--color-surface)');
  });

  it('does not apply over-budget background when budget is null', () => {
    const { container } = render(
      <DebtPaymentCard account={makeDebtAccount()} spent={9999} budget={null} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.background).toBe('var(--color-surface)');
  });

  it('calls onClick with the account when clicked', () => {
    const onClick = vi.fn();
    const account = makeDebtAccount({ name: 'Student Loan' });
    render(<DebtPaymentCard account={account} spent={100} budget={null} onClick={onClick} />);
    fireEvent.click(screen.getByText('Student Loan'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith(account);
  });

  it('does not throw when clicked without onClick handler', () => {
    const account = makeDebtAccount();
    render(<DebtPaymentCard account={account} spent={100} budget={null} />);
    expect(() => fireEvent.click(screen.getByText('Car Loan'))).not.toThrow();
  });

  it('card root has a minimum height of 44px for touch target', () => {
    const { container } = render(
      <DebtPaymentCard account={makeDebtAccount()} spent={100} budget={null} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.minHeight).toBe('44px');
  });
});
