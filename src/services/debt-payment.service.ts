import type { Account } from "../db/models";

export interface PaymentSplit {
  interestAmount: number;
  principalAmount: number;
}

export function getMonthlyRate(account: Account): number | null {
  if (account.type !== "DEBT") return null;
  if (account.mortgageInterestRate != null) return account.mortgageInterestRate / 12;
  return null;
}

export function calculatePaymentSplit(
  currentBalance: number, // absolute value of current debt (positive number = amount owed)
  monthlyRate: number,
  paymentAmount: number,
): PaymentSplit {
  const rawInterest = Math.abs(currentBalance) * monthlyRate;
  // Round interest first, then derive principal from the rounded interest.
  // Rounding both legs independently can cause `interest + principal !== paymentAmount`
  // by one minor unit (the two halves of a rounding boundary disagree).
  const interestAmount = Math.round(Math.min(rawInterest, paymentAmount));
  const principalAmount = Math.max(0, paymentAmount - interestAmount);
  return { interestAmount, principalAmount };
}

export function calculateMortgagePayment(
  loanAmount: number,
  annualRate: number,
  termYears: number,
): number {
  if (loanAmount <= 0 || termYears <= 0) return 0;
  const n = termYears * 12;
  if (annualRate <= 0) return Math.ceil(loanAmount / n);
  const r = annualRate / 12;
  return Math.ceil((loanAmount * r) / (1 - Math.pow(1 + r, -n)));
}

export function calculateTermSaved(
  currentBalance: number,
  overpayment: number,
  monthlyRate: number,
  monthlyPayment: number,
): number | null {
  if (currentBalance <= 0 || overpayment <= 0 || monthlyRate <= 0 || monthlyPayment <= 0) {
    return null;
  }
  const x = 1 - (currentBalance * monthlyRate) / monthlyPayment;
  if (x <= 0) return null;
  const currentN = -Math.log(x) / Math.log(1 + monthlyRate);
  // Full-payoff (or overpayment >= remaining balance) clears the entire
  // remaining term — return the rounded current term rather than null, so the
  // UI can show "you saved N months" on the final lump-sum payment.
  if (overpayment >= currentBalance) {
    const saved = Math.round(currentN);
    return saved > 0 ? saved : null;
  }
  const newBalance = currentBalance - overpayment;
  // newBalance < currentBalance and x > 0, so newX > x > 0 — the guard is provably unreachable.
  const newX = 1 - (newBalance * monthlyRate) / monthlyPayment;
  const newN = -Math.log(newX) / Math.log(1 + monthlyRate);
  const saved = Math.round(currentN - newN);
  if (saved <= 0) return null;
  return saved;
}
