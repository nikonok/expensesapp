import { GripVertical, X } from 'lucide-react';
import type { Category } from '../../db/models';
import { getLucideIcon } from '../shared/IconPicker';

interface CategoryCardProps {
  category: Category;
  spent: number;
  budget: number | null;
  editMode: boolean;
  onRemove?: (id: number) => void;
  onClick?: (category: Category) => void;
}

export default function CategoryCard({
  category,
  spent,
  budget,
  editMode,
  onRemove,
  onClick,
}: CategoryCardProps) {
  const isOverBudget = budget !== null && spent > budget;
  const progress = budget !== null && budget > 0 ? Math.min(spent / budget, 1) : 0;

  const Icon = getLucideIcon(category.icon);
  const isEmoji = !Icon && category.icon !== '';

  function handleClick() {
    if (!editMode && onClick) {
      onClick(category);
    }
  }

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        paddingBottom: '16px', // room for bar
        background: isOverBudget ? 'var(--color-expense-dim)' : 'var(--color-surface)',
        borderRadius: 'var(--radius-card)',
        borderLeft: `3px solid var(--card-color)`,
        cursor: editMode ? 'default' : 'pointer',
        userSelect: 'none',
        // Set the --card-color CSS variable
        ['--card-color' as string]: category.color,
        overflow: 'hidden',
      }}
    >
      {/* Drag handle (edit mode) */}
      {editMode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-disabled)',
            flexShrink: 0,
            cursor: 'grab',
            touchAction: 'none',
          }}
        >
          <GripVertical size={18} strokeWidth={1.5} />
        </div>
      )}

      {/* Icon */}
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
          color: category.color,
        }}
      >
        {isEmoji ? (
          <span style={{ fontSize: '18px', lineHeight: 1 }}>{category.icon}</span>
        ) : Icon ? (
          <Icon size={18} strokeWidth={1.5} />
        ) : null}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {category.name}
        </span>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 500,
            fontSize: 'var(--text-amount-sm)',
          }}
        >
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Budget: {budget !== null ? budget.toFixed(2) : '—'}
          </span>
          <span
            style={{
              color: isOverBudget ? 'var(--color-expense)' : 'var(--color-text)',
            }}
          >
            Spent: {spent.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Remove button (edit mode) */}
      {editMode && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(category.id!);
          }}
          aria-label={`Remove ${category.name}`}
          style={{
            width: '32px',
            height: '32px',
            minWidth: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-expense-dim)',
            border: '1px solid oklch(62% 0.28 18 / 30%)',
            borderRadius: '50%',
            cursor: 'pointer',
            color: 'var(--color-expense)',
            flexShrink: 0,
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}

      {/* Budget progress bar — flush at bottom */}
      {budget !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'var(--color-border)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: isOverBudget ? 'var(--color-expense)' : 'var(--card-color)',
              transition: 'width 300ms ease-out',
            }}
          />
        </div>
      )}
    </div>
  );
}
