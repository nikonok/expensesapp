import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import BottomSheet from '../layout/BottomSheet';
import { useUIStore } from '../../stores/ui-store';
import { useCategories } from '../../hooks/use-categories';
import { useAccounts } from '../../hooks/use-accounts';
import { getLucideIcon } from '../shared/IconPicker';

interface TransactionFiltersProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TransactionFilters({ isOpen, onClose }: TransactionFiltersProps) {
  const {
    transactionNoteFilter,
    transactionCategoryFilter,
    transactionAccountFilter,
    setTransactionNoteFilter,
    setTransactionCategoryFilter,
    setTransactionAccountFilter,
    clearTransactionFilters,
  } = useUIStore();

  const activeCategories = useCategories(undefined, false);
  const activeAccounts = useAccounts(false);
  const allAccounts = useAccounts(true);
  const archivedAccounts = allAccounts.filter((a) => a.isTrashed);

  const [archivedExpanded, setArchivedExpanded] = useState(false);

  function handleClearAll() {
    clearTransactionFilters();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Filters">
      <div
        style={{
          paddingInline: 'var(--space-4)',
          paddingBottom: 'var(--space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
        {/* Note contains */}
        <section>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Note contains
            </span>
            <input
              type="text"
              value={transactionNoteFilter}
              onChange={(e) => setTransactionNoteFilter(e.target.value)}
              placeholder="Search notes…"
              style={{
                minHeight: '44px',
                padding: '0 var(--space-3)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-input)',
                color: 'var(--color-text)',
                fontFamily: '"DM Sans", sans-serif',
                fontSize: 'var(--text-body)',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </label>
        </section>

        {/* Category */}
        <section>
          <p
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 0 var(--space-2)',
            }}
          >
            Category
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activeCategories.map((cat) => {
              const isSelected = transactionCategoryFilter === cat.id;
              const Icon = getLucideIcon(cat.icon);
              return (
                <button
                  key={cat.id}
                  onClick={() => setTransactionCategoryFilter(isSelected ? null : cat.id!)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    minHeight: '48px',
                    padding: '0 var(--space-1)',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: `color-mix(in oklch, ${cat.color} 20%, transparent)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: cat.color,
                      flexShrink: 0,
                    }}
                  >
                    {Icon ? (
                      <Icon size={14} strokeWidth={1.5} />
                    ) : (
                      <span style={{ fontSize: '14px', lineHeight: 1 }}>{cat.icon}</span>
                    )}
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontFamily: '"DM Sans", sans-serif',
                      fontWeight: 500,
                      fontSize: 'var(--text-body)',
                    }}
                  >
                    {cat.name}
                  </span>
                  {isSelected && (
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: 'var(--color-primary)',
                        flexShrink: 0,
                        boxShadow: '0 0 6px var(--color-primary)',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Account */}
        <section>
          <p
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 0 var(--space-2)',
            }}
          >
            Account
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activeAccounts.map((acc) => {
              const isSelected = transactionAccountFilter === acc.id;
              const Icon = getLucideIcon(acc.icon);
              return (
                <button
                  key={acc.id}
                  onClick={() => setTransactionAccountFilter(isSelected ? null : acc.id!)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    minHeight: '48px',
                    padding: '0 var(--space-1)',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: `color-mix(in oklch, ${acc.color} 20%, transparent)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: acc.color,
                      flexShrink: 0,
                    }}
                  >
                    {Icon ? (
                      <Icon size={14} strokeWidth={1.5} />
                    ) : (
                      <span style={{ fontSize: '14px', lineHeight: 1 }}>{acc.icon}</span>
                    )}
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontFamily: '"DM Sans", sans-serif',
                      fontWeight: 500,
                      fontSize: 'var(--text-body)',
                    }}
                  >
                    {acc.name}
                  </span>
                  {isSelected && (
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: 'var(--color-primary)',
                        flexShrink: 0,
                        boxShadow: '0 0 6px var(--color-primary)',
                      }}
                    />
                  )}
                </button>
              );
            })}

            {/* Archived accounts */}
            {archivedAccounts.length > 0 && (
              <>
                <button
                  onClick={() => setArchivedExpanded((v) => !v)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: '44px',
                    padding: '0 var(--space-1)',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontWeight: 500,
                      fontSize: 'var(--text-body)',
                    }}
                  >
                    Archived ({archivedAccounts.length})
                  </span>
                  {archivedExpanded ? (
                    <ChevronUp size={16} strokeWidth={2} />
                  ) : (
                    <ChevronDown size={16} strokeWidth={2} />
                  )}
                </button>

                {archivedExpanded &&
                  archivedAccounts.map((acc) => {
                    const isSelected = transactionAccountFilter === acc.id;
                    const Icon = getLucideIcon(acc.icon);
                    return (
                      <button
                        key={acc.id}
                        onClick={() => setTransactionAccountFilter(isSelected ? null : acc.id!)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                          minHeight: '48px',
                          padding: '0 var(--space-1)',
                          background: 'none',
                          border: 'none',
                          borderBottom: '1px solid var(--color-border)',
                          cursor: 'pointer',
                          color: isSelected ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                          textAlign: 'left',
                          opacity: 0.7,
                        }}
                      >
                        <div
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: `color-mix(in oklch, ${acc.color} 20%, transparent)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: acc.color,
                            flexShrink: 0,
                          }}
                        >
                          {Icon ? (
                            <Icon size={14} strokeWidth={1.5} />
                          ) : (
                            <span style={{ fontSize: '14px', lineHeight: 1 }}>{acc.icon}</span>
                          )}
                        </div>
                        <span
                          style={{
                            flex: 1,
                            fontFamily: '"DM Sans", sans-serif',
                            fontWeight: 500,
                            fontSize: 'var(--text-body)',
                          }}
                        >
                          {acc.name}
                        </span>
                        {isSelected && (
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: 'var(--color-primary)',
                              flexShrink: 0,
                              boxShadow: '0 0 6px var(--color-primary)',
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
              </>
            )}
          </div>
        </section>

        {/* Clear all */}
        <button
          onClick={handleClearAll}
          style={{
            minHeight: '44px',
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-btn)',
            color: 'var(--color-text-secondary)',
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
            cursor: 'pointer',
          }}
        >
          Clear all
        </button>
      </div>
    </BottomSheet>
  );
}
