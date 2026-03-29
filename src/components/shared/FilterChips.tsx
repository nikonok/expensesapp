interface FilterChipsProps {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}

export function FilterChips({ options, value, onChange }: FilterChipsProps) {
  return (
    <div
      role="group"
      aria-label="Filter"
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 'var(--space-2)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        paddingBottom: '2px',
      }}
    >
      {options.map((opt) => {
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(isActive ? null : opt.id)}
            style={{
              flexShrink: 0,
              height: '36px',
              padding: '0 var(--space-3)',
              background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
              color: isActive ? 'var(--color-bg)' : 'var(--color-text-secondary)',
              border: `1px solid ${isActive ? 'transparent' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-chip)',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-caption)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              filter: isActive
                ? 'drop-shadow(0 0 6px oklch(72% 0.22 210 / 50%))'
                : 'none',
              transition: 'background 100ms ease-out, color 100ms ease-out, filter 100ms ease-out',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
