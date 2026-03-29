import { Trash2, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useCategories } from '../../hooks/use-categories';
import { db } from '../../db/database';
import { EmptyState } from '../shared/EmptyState';
import { getLucideIcon } from '../shared/IconPicker';
import { getUTCISOString } from '../../utils/date-utils';

export default function TrashedCategories() {
  const navigate = useNavigate();
  const trashed = useCategories(undefined, true).filter((c) => c.isTrashed);

  async function handleRestore(id: number) {
    await db.categories.update(id, { isTrashed: false, updatedAt: getUTCISOString() });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={() => navigate('/categories')}
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: 0,
          }}
          aria-label="Back"
        >
          ← Back
        </button>
        <h2
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-heading)',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          Trash
        </h2>
        <div style={{ minWidth: '44px' }} />
      </div>

      {/* Content */}
      {trashed.length === 0 ? (
        <EmptyState
          icon={Trash2}
          heading="Trash is empty"
          body="Removed categories will appear here and can be restored."
        />
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            padding: 'var(--space-4)',
          }}
        >
          {trashed.map((cat) => {
            const Icon = getLucideIcon(cat.icon);
            const isEmoji = !Icon && cat.icon !== '';

            return (
              <div
                key={cat.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-surface)',
                  borderRadius: 'var(--radius-card)',
                  borderLeft: `3px solid ${cat.color}`,
                  opacity: 0.7,
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: 'var(--radius-icon)',
                    background: 'var(--color-surface-raised)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: cat.color,
                  }}
                >
                  {isEmoji ? (
                    <span style={{ fontSize: '18px', lineHeight: 1 }}>{cat.icon}</span>
                  ) : Icon ? (
                    <Icon size={18} strokeWidth={1.5} />
                  ) : null}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontWeight: 500,
                      fontSize: 'var(--text-body)',
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                  >
                    {cat.name}
                  </span>
                  <span
                    style={{
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 'var(--text-caption)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {cat.type === 'EXPENSE' ? 'Expense' : 'Income'}
                  </span>
                </div>

                <button
                  onClick={() => cat.id !== undefined && handleRestore(cat.id)}
                  aria-label={`Restore ${cat.name}`}
                  style={{
                    minWidth: '44px',
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-primary-dim)',
                    border: '1px solid var(--color-primary)',
                    borderRadius: 'var(--radius-btn)',
                    cursor: 'pointer',
                    color: 'var(--color-primary)',
                    flexShrink: 0,
                    gap: '4px',
                    padding: '0 var(--space-3)',
                    fontFamily: '"DM Sans", sans-serif',
                    fontWeight: 500,
                    fontSize: 'var(--text-caption)',
                  }}
                >
                  <RotateCcw size={14} strokeWidth={2} />
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
