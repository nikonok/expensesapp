import type { Account } from '../db/models';

export interface PaymentSplit {
  interestAmount: number;
  principalAmount: number;
}

export function getMonthlyRate(account: Account): number | null {
  if (account.type !== 'DEBT') return null;
  if (account.interestRateMonthly != null) return account.interestRateMonthly;
  if (account.interestRateYearly != null) return account.interestRateYearly / 12;
  if (account.mortgageInterestRate != null) return account.mortgageInterestRate / 12;
  return null;
}

export function calculatePaymentSplit(
  currentBalance: number,  // absolute value of current debt (positive number = amount owed)
  monthlyRate: number,
  paymentAmount: number,
): PaymentSplit {
  const rawInterest = Math.abs(currentBalance) * monthlyRate;
  const interestAmount = Math.round(Math.min(rawInterest, paymentAmount));
  const principalAmount = Math.round(Math.max(0, paymentAmount - interestAmount));
  return { interestAmount, principalAmount };
}
