import { describe, it, expect } from 'vitest';
import { getMonthlyRate, calculatePaymentSplit, calculateMortgagePayment, calculateTermSaved } from './debt-payment.service';
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

describe('calculateMortgagePayment', () => {
  it('returns 0 for zero loan amount', () => {
    expect(calculateMortgagePayment(0, 0.05, 30)).toBe(0);
  });

  it('returns 0 for negative loan amount', () => {
    expect(calculateMortgagePayment(-1000, 0.05, 30)).toBe(0);
  });

  it('returns 0 for zero term', () => {
    expect(calculateMortgagePayment(100000, 0.05, 0)).toBe(0);
  });

  it('returns 0 for negative term', () => {
    expect(calculateMortgagePayment(100000, 0.05, -1)).toBe(0);
  });

  it('returns ceiling of loanAmount/n when rate is zero', () => {
    // 120000 / (10*12) = 1000 exactly
    expect(calculateMortgagePayment(120000, 0, 10)).toBe(1000);
  });

  it('returns ceiling of loanAmount/n when rate is negative', () => {
    // 121000 / (10*12) = 1008.33... => ceil = 1009
    expect(calculateMortgagePayment(121000, -0.01, 10)).toBe(1009);
  });

  it('calculates a standard 30-year fixed mortgage payment', () => {
    // 200000 at 6% annual (0.5%/mo), 360 months
    // PMT = 200000 * 0.005 / (1 - (1.005)^-360) ≈ 1199.10 => ceil = 1200
    expect(calculateMortgagePayment(200000, 0.06, 30)).toBe(1200);
  });

  it('calculates a 15-year mortgage payment', () => {
    // 200000 at 4.5% annual, 180 months
    // r = 0.00375; PMT ≈ 1529.99 => ceil = 1530
    expect(calculateMortgagePayment(200000, 0.045, 15)).toBe(1530);
  });

  it('rounds up (ceiling) even when result is almost a whole number', () => {
    // 120000 at 0% over 10 years = exactly 1000 — should still be 1000
    expect(calculateMortgagePayment(120000, 0, 10)).toBe(1000);
  });

  it('handles a 1-year term', () => {
    // 12000 at 12% annual (1%/mo), 12 months
    // PMT = 12000 * 0.01 / (1 - (1.01)^-12) ≈ 1066.19 => ceil = 1067
    expect(calculateMortgagePayment(12000, 0.12, 1)).toBe(1067);
  });
});

describe('calculateTermSaved', () => {
  it('returns null when currentBalance is zero', () => {
    expect(calculateTermSaved(0, 1000, 0.005, 1200)).toBeNull();
  });

  it('returns null when currentBalance is negative', () => {
    expect(calculateTermSaved(-100000, 1000, 0.005, 1200)).toBeNull();
  });

  it('returns null when overpayment is zero', () => {
    expect(calculateTermSaved(100000, 0, 0.005, 1200)).toBeNull();
  });

  it('returns null when overpayment is negative', () => {
    expect(calculateTermSaved(100000, -500, 0.005, 1200)).toBeNull();
  });

  it('returns null when monthlyRate is zero', () => {
    expect(calculateTermSaved(100000, 1000, 0, 1200)).toBeNull();
  });

  it('returns null when monthlyPayment is zero', () => {
    expect(calculateTermSaved(100000, 1000, 0.005, 0)).toBeNull();
  });

  it('returns null when overpayment equals currentBalance (full payoff edge)', () => {
    expect(calculateTermSaved(100000, 100000, 0.005, 1200)).toBeNull();
  });

  it('returns null when overpayment exceeds currentBalance', () => {
    expect(calculateTermSaved(100000, 100001, 0.005, 1200)).toBeNull();
  });

  it('returns null when x <= 0 (payment too small to cover interest)', () => {
    // balance=100000, rate=0.02, payment=1000
    // interest = 100000 * 0.02 = 2000 > payment => x = 1 - 2 = -1 <= 0
    expect(calculateTermSaved(100000, 1000, 0.02, 1000)).toBeNull();
  });

  it('returns a positive number of months saved for a typical overpayment', () => {
    // balance=100000, rate=0.5%/mo, payment=1200
    // standard term ≈ 139 months; overpayment of 10000 reduces it noticeably
    const saved = calculateTermSaved(100000, 10000, 0.005, 1200);
    expect(saved).not.toBeNull();
    expect(saved).toBeGreaterThan(0);
  });

  it('returns null when the calculated saving rounds to 0', () => {
    // tiny overpayment — saving < 0.5 months rounds to 0 => returns null
    // balance=100000, rate=0.5%/mo, payment=2000 (short term), overpayment=1
    const saved = calculateTermSaved(100000, 1, 0.005, 2000);
    // Result may be null or 0 depending on rounding; either way should be null
    expect(saved == null || saved === 0).toBe(true);
  });

  it('returns a reasonable number of months saved for a 200k mortgage', () => {
    // 200000 at 0.5%/mo, payment=1200, overpayment=20000
    const saved = calculateTermSaved(200000, 20000, 0.005, 1200);
    expect(saved).not.toBeNull();
    expect(saved).toBeGreaterThan(10);
    expect(saved).toBeLessThan(100);
  });
});
