import { useEffect, useState } from 'react';
import { Edit2, Trash2, X } from 'lucide-react';

interface SelectionToolbarProps {
  selectedIds: Set<number>;
  onEdit: () => void;
  onRemove: () => void;
  onClear: () => void;
}

export default function SelectionToolbar({
  selectedIds,
  onEdit,
  onRemove,
  onClear,
}: SelectionToolbarProps) {
  const count = selectedIds.size;
  const isSingle = count === 1;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (count > 0) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [count]);

  if (count === 0 && !visible) return null;

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'calc(56px + env(safe-area-inset-bottom))',
        background: 'var(--color-surface-raised)',
        borderTop: '1px solid var(--color-border-strong)',
        zIndex: 'var(--z-nav)',
        display: 'flex',
        alignItems: 'center',
        paddingInline: 'var(--space-4)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        gap: 'var(--space-3)',
        maxWidth: '480px',
        marginInline: 'auto',
        transform: count > 0 ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 200ms ease-out',
      }}
    >
      {/* Clear / count */}
      <button
        aria-label="Clear selection"
        onClick={onClear}
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
      >
        <X size={20} strokeWidth={1.5} />
      </button>

      <span
        style={{
          flex: 1,
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: 'var(--text-body)',
          color: 'var(--color-text)',
        }}
      >
        {count} selected
      </span>

      {/* Edit — single only */}
      {isSingle && (
        <button
          aria-label="Edit transaction"
          onClick={onEdit}
          style={{
            minHeight: '44px',
            padding: '0 var(--space-4)',
            background: 'var(--color-primary-dim)',
            border: '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-btn)',
            color: 'var(--color-primary)',
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            transition: 'background 100ms ease-out',
          }}
        >
          <Edit2 size={16} strokeWidth={1.5} />
          Edit
        </button>
      )}

      {/* Remove */}
      <button
        aria-label="Remove selected transactions"
        onClick={onRemove}
        style={{
          minHeight: '44px',
          padding: '0 var(--space-4)',
          background: 'var(--color-expense-dim)',
          border: '1px solid oklch(62% 0.28 18 / 50%)',
          borderRadius: 'var(--radius-btn)',
          color: 'var(--color-expense)',
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: 'var(--text-body)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          transition: 'background 100ms ease-out',
        }}
      >
        <Trash2 size={16} strokeWidth={1.5} />
        Remove
      </button>
    </div>
  );
}
