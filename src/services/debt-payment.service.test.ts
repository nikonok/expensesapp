import { describe, it, expect } from 'vitest';
import { getMonthlyRate, calculatePaymentSplit } from './debt-payment.service';
import type { Account } from '../db/models';

function makeAccount(overrides: Partial<Account>): Account {
  return {
    name: 'Test',
    type: 'DEBT',
    color: 'oklch(60% 0.2 30)',
    icon: 'home',
    currency: 'USD',
    description: '',
    balance: -100000,
    startingBalance: -100000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getMonthlyRate', () => {
  it('returns null for REGULAR accounts', () => {
    expect(getMonthlyRate(makeAccount({ type: 'REGULAR' }))).toBeNull();
  });

  it('returns null for SAVINGS accounts', () => {
    expect(getMonthlyRate(makeAccount({ type: 'SAVINGS' }))).toBeNull();
  });

  it('returns null for DEBT with no rate set', () => {
    expect(getMonthlyRate(makeAccount({}))).toBeNull();
  });

  it('returns interestRateMonthly directly when set', () => {
    expect(getMonthlyRate(makeAccount({ interestRateMonthly: 0.005 }))).toBe(0.005);
  });

  it('converts interestRateYearly to monthly', () => {
    expect(getMonthlyRate(makeAccount({ interestRateYearly: 0.06 }))).toBeCloseTo(0.005, 10);
  });

  it('converts mortgageInterestRate to monthly', () => {
    expect(getMonthlyRate(makeAccount({ mortgageInterestRate: 0.048 }))).toBeCloseTo(0.004, 10);
  });

  it('prefers interestRateMonthly over yearly', () => {
    expect(
      getMonthlyRate(makeAccount({ interestRateMonthly: 0.003, interestRateYearly: 0.06 })),
    ).toBe(0.003);
  });

  it('returns 0 when interestRateYearly is explicitly 0', () => {
    expect(getMonthlyRate(makeAccount({ type: 'DEBT', interestRateYearly: 0 }))).toBe(0);
  });
});

describe('calculatePaymentSplit', () => {
  it('splits a normal payment correctly', () => {
    // balance = 100000, monthly rate = 0.5% => interest = 500
    // payment = 1200 => principal = 700
    const split = calculatePaymentSplit(100000, 0.005, 1200);
    expect(split.interestAmount).toBe(500);
    expect(split.principalAmount).toBe(700);
  });

  it('handles payment exactly equal to interest', () => {
    const split = calculatePaymentSplit(100000, 0.005, 500);
    expect(split.interestAmount).toBe(500);
    expect(split.principalAmount).toBe(0);
  });

  it('handles payment less than interest (caps principal at 0)', () => {
    const split = calculatePaymentSplit(100000, 0.005, 200);
    expect(split.interestAmount).toBe(200);
    expect(split.principalAmount).toBe(0);
  });

  it('handles zero balance', () => {
    const split = calculatePaymentSplit(0, 0.005, 1000);
    expect(split.interestAmount).toBe(0);
    expect(split.principalAmount).toBe(1000);
  });

  it('handles zero rate', () => {
    const split = calculatePaymentSplit(100000, 0, 1000);
    expect(split.interestAmount).toBe(0);
    expect(split.principalAmount).toBe(1000);
  });

  it('rounds to nearest integer (minor units)', () => {
    // balance = 10000, rate = 0.333% => interest = Math.round(10000 * 0.003333) = 33
    const split = calculatePaymentSplit(10000, 0.003333, 500);
    expect(split.interestAmount).toBe(33);
    expect(split.principalAmount).toBe(467);
  });

  it('handles exact payoff (payment covers full balance + interest)', () => {
    const split = calculatePaymentSplit(1000, 0.01, 1010);
    expect(split.interestAmount).toBe(10);
    expect(split.principalAmount).toBe(1000);
  });

  it('uses absolute value of negative balance', () => {
    // balance stored as negative in DEBT accounts
    const split = calculatePaymentSplit(-100000, 0.005, 1200);
    expect(split.interestAmount).toBe(500);
    expect(split.principalAmount).toBe(700);
  });
});
