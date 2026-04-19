import { useState } from "react";
import { useNavigate } from "react-router";
import { Archive, ArrowDownCircle, ArrowUpCircle, List, Plus } from "lucide-react";
import { db } from "../../db/database";
import type { Account } from "../../db/models";
import { adjustBalance } from "../../services/balance.service";
import { useUIStore } from "../../stores/ui-store";
import BottomSheet from "../layout/BottomSheet";
import { Numpad } from "../shared/Numpad";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { getLucideIcon } from "../shared/IconPicker";
import { useToast } from "../shared/Toast";
import { NumpadDisplay } from "../shared/NumpadDisplay";
import { calculateMortgagePayment, getMonthlyRate } from "../../services/debt-payment.service";

interface AccountDetailProps {
  account: Account;
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
}

export default function AccountDetail({ account, isOpen, onClose, onEdit }: AccountDetailProps) {
  const navigate = useNavigate();
  const { show: showToast } = useToast();
  const setTransactionAccountFilter = useUIStore((s) => s.setTransactionAccountFilter);

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustValue, setAdjustValue] = useState("");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const Icon = getLucideIcon(account.icon);
  const isDebt = account.type === "DEBT";
  const isSavings = account.type === "SAVINGS";
  const isNegativeBalance = !isDebt && account.balance < 0;
  const hasGoal = isSavings && account.savingsGoal != null && account.savingsGoal > 0;
  const progress = hasGoal ? Math.min(1, account.balance / account.savingsGoal!) : 0;
  const hasDebtOriginalAmount =
    isDebt && account.debtOriginalAmount != null && account.debtOriginalAmount > 0;
  const debtProgress = hasDebtOriginalAmount
    ? Math.min(
        1,
        Math.max(0, (account.debtOriginalAmount! - account.balance) / account.debtOriginalAmount!),
      )
    : 0;

  const formatAmount = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: account.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v / 100);

  // Debt calculations
  const monthlyRate = getMonthlyRate(account);
  const accruedInterest = monthlyRate != null ? Math.abs(account.balance) * monthlyRate : null;

  // Mortgage time left
  let timeLeft: string | null = null;
  if (
    account.mortgageLoanAmount != null &&
    account.mortgageLoanAmount > 0 &&
    account.mortgageTermYears != null &&
    account.mortgageTermYears > 0
  ) {
    const balance = Math.abs(account.balance);
    if (balance <= 0) {
      timeLeft = "Paid off";
    } else {
      const r = account.mortgageInterestRate != null ? account.mortgageInterestRate / 12 : 0;
      const monthlyPayment = calculateMortgagePayment(
        account.mortgageLoanAmount ?? 0,
        account.mortgageInterestRate ?? 0,
        account.mortgageTermYears ?? 0,
      );
      if (monthlyPayment > 0) {
        let remainingMonths: number | null = null;
        if (r > 0) {
          const x = 1 - (balance * r) / monthlyPayment;
          if (x > 0) {
            remainingMonths = Math.ceil(-Math.log(x) / Math.log(1 + r));
          }
          // x <= 0: unserviceable — leave remainingMonths as null, timeLeft stays null
        } else {
          remainingMonths = Math.ceil(balance / monthlyPayment);
        }
        if (remainingMonths !== null) {
          if (remainingMonths <= 0) {
            timeLeft = "Paid off";
          } else {
            const years = Math.floor(remainingMonths / 12);
            const remMonths = remainingMonths % 12;
            timeLeft = years > 0 ? `${years}y ${remMonths}m` : `${remMonths}m`;
          }
        }
      }
    }
  }

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      await db.accounts.update(account.id!, {
        isTrashed: true,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } finally {
      setIsArchiving(false);
      setShowArchiveConfirm(false);
    }
  };

  const handleViewTransactions = () => {
    setTransactionAccountFilter(account.id!);
    onClose();
    navigate("/transactions");
  };

  const handleAddIncome = () => {
    onClose();
    navigate(`/transactions/new?type=income&accountId=${account.id}`);
  };

  const handleAddWithdrawal = () => {
    onClose();
    navigate(`/transactions/new?type=expense&accountId=${account.id}`);
  };

  const handleAddDebtTransaction = () => {
    onClose();
    navigate(`/transactions/new?type=expense&toAccountId=${account.id}`);
  };

  const shortcutBtnStyle: React.CSSProperties = {
    flex: 1,
    minHeight: "52px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-card)",
    cursor: "pointer",
    color: "var(--color-text-secondary)",
    transition: "background 80ms ease-out",
  };

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            padding: "0 var(--space-4) var(--space-8)",
          }}
        >
          {/* Account header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: `color-mix(in oklch, ${account.color} 20%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: account.color,
              }}
            >
              {Icon ? (
                <Icon size={24} strokeWidth={1.5} />
              ) : (
                <span style={{ fontSize: "24px", lineHeight: 1 }}>{account.icon}</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "Syne, sans-serif",
                  fontWeight: 700,
                  fontSize: "var(--text-heading)",
                  color: "var(--color-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {account.name}
              </div>
              <div
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: "var(--text-amount-md)",
                  color: isDebt || isNegativeBalance ? "var(--color-expense)" : "var(--color-text)",
                  textShadow:
                    isDebt || isNegativeBalance ? "0 0 12px oklch(62% 0.28 18 / 40%)" : "none",
                }}
              >
                {isNegativeBalance ? "\u2212" : ""}
                {formatAmount(Math.abs(account.balance))}
              </div>
            </div>
            <button
              onClick={onEdit}
              style={{
                minWidth: "44px",
                minHeight: "44px",
                background: "var(--color-surface-raised)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-btn)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-caption)",
              }}
            >
              Edit
            </button>
          </div>

          {/* Savings progress */}
          {hasGoal && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: "var(--text-caption)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Progress
                </span>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: "var(--text-caption)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {formatAmount(account.balance)} / {formatAmount(account.savingsGoal!)}
                </span>
              </div>
              <div
                style={{ height: "6px", borderRadius: "9999px", background: "var(--color-border)" }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress * 100}%`,
                    background: account.color,
                    borderRadius: "9999px",
                    transition: "width 300ms ease-out",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: "var(--text-caption)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {Math.round(progress * 100)}% of goal
              </span>
            </div>
          )}

          {/* Debt payoff progress */}
          {isDebt && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {hasDebtOriginalAmount && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: "var(--text-caption)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Paid off
                  </span>
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: "var(--text-caption)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {formatAmount(account.debtOriginalAmount! - account.balance)} /{" "}
                    {formatAmount(account.debtOriginalAmount!)}
                  </span>
                </div>
              )}
              <div
                style={{
                  height: "6px",
                  borderRadius: "9999px",
                  background: "var(--color-border)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${debtProgress * 100}%`,
                    background: "var(--color-expense)",
                    borderRadius: "9999px",
                    transition: "width 300ms ease-out",
                  }}
                />
              </div>
              {hasDebtOriginalAmount && (
                <span
                  style={{
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: "var(--text-caption)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {Math.round(debtProgress * 100)}% paid off
                </span>
              )}
            </div>
          )}

          {/* Debt details */}
          {isDebt && (accruedInterest != null || timeLeft != null) && (
            <div
              style={{
                background: "var(--color-surface)",
                borderRadius: "var(--radius-card)",
                padding: "var(--space-3) var(--space-4)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              {accruedInterest != null && accruedInterest > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: "var(--text-body)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Monthly interest
                  </span>
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 600,
                      fontSize: "var(--text-body)",
                      color: "var(--color-expense)",
                    }}
                  >
                    {formatAmount(accruedInterest)}
                  </span>
                </div>
              )}
              {timeLeft && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: "var(--text-body)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Time remaining
                  </span>
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontWeight: 600,
                      fontSize: "var(--text-body)",
                      color: "var(--color-text)",
                    }}
                  >
                    {timeLeft}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Adjust balance */}
          {!showAdjust ? (
            <button
              onClick={() => {
                setAdjustValue(String(Math.abs(account.balance) / 100));
                setShowAdjust(true);
              }}
              style={{
                minHeight: "44px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-btn)",
                color: "var(--color-text)",
                cursor: "pointer",
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-body)",
              }}
            >
              Adjust Balance
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 500,
                  fontSize: "var(--text-caption)",
                  color: "var(--color-text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                New Balance ({account.currency})
              </span>
              <NumpadDisplay
                value={adjustValue}
                isActive={true}
                align="center"
                style={{ padding: "var(--space-3)" }}
              />
              <Numpad
                value={adjustValue}
                onChange={setAdjustValue}
                onSave={async (v) => {
                  try {
                    await adjustBalance(account.id!, v);
                    setAdjustValue("");
                    setShowAdjust(false);
                  } catch (err) {
                    console.error("Failed to adjust balance:", err);
                    showToast("Failed to adjust balance", "error");
                  }
                }}
                variant="budget"
                currencyCode={account.currency}
              />
              <button
                onClick={() => {
                  setShowAdjust(false);
                  setAdjustValue("");
                }}
                style={{
                  minHeight: "44px",
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-btn)",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: "var(--text-body)",
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Shortcut buttons */}
          {!showAdjust && (
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              {isDebt ? (
                <button onClick={handleAddDebtTransaction} style={shortcutBtnStyle}>
                  <Plus size={20} strokeWidth={1.5} />
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: "var(--text-caption)",
                      fontWeight: 500,
                    }}
                  >
                    New transaction
                  </span>
                </button>
              ) : (
                <>
                  <button onClick={handleAddIncome} style={shortcutBtnStyle}>
                    <ArrowDownCircle
                      size={20}
                      strokeWidth={1.5}
                      style={{ color: "var(--color-income)" }}
                    />
                    <span
                      style={{
                        fontFamily: '"DM Sans", sans-serif',
                        fontSize: "var(--text-caption)",
                        fontWeight: 500,
                      }}
                    >
                      Income
                    </span>
                  </button>
                  <button onClick={handleAddWithdrawal} style={shortcutBtnStyle}>
                    <ArrowUpCircle
                      size={20}
                      strokeWidth={1.5}
                      style={{ color: "var(--color-expense)" }}
                    />
                    <span
                      style={{
                        fontFamily: '"DM Sans", sans-serif',
                        fontSize: "var(--text-caption)",
                        fontWeight: 500,
                      }}
                    >
                      Expense
                    </span>
                  </button>
                </>
              )}
              <button onClick={handleViewTransactions} style={shortcutBtnStyle}>
                <List size={20} strokeWidth={1.5} />
                <span
                  style={{
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: "var(--text-caption)",
                    fontWeight: 500,
                  }}
                >
                  Transactions
                </span>
              </button>
            </div>
          )}

          {/* Archive */}
          {!showAdjust && (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              style={{
                minHeight: "44px",
                background: "var(--color-expense-dim)",
                border: "1px solid oklch(62% 0.28 18 / 50%)",
                borderRadius: "var(--radius-btn)",
                color: "var(--color-expense)",
                cursor: "pointer",
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: "var(--text-body)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-2)",
              }}
            >
              <Archive size={16} strokeWidth={1.5} />
              Archive Account
            </button>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        isOpen={showArchiveConfirm}
        title="Archive Account?"
        body="This account will be hidden from the active list. All transactions will be preserved. You can restore it from the trash."
        confirmLabel={isArchiving ? "Archiving…" : "Archive"}
        onConfirm={handleArchive}
        onCancel={() => setShowArchiveConfirm(false)}
        variant="destructive"
      />
    </>
  );
}
