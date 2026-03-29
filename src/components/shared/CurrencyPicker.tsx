import { useState, useMemo } from 'react';
import { DEFAULT_CURRENCIES } from '../../db/seed';

interface CurrencyPickerProps {
  value: string;
  onChange: (v: string) => void;
}

let displayNames: Intl.DisplayNames | null = null;
try {
  displayNames = new Intl.DisplayNames('en', { type: 'currency' });
} catch {
  displayNames = null;
}

function getCurrencyName(code: string): string {
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function CurrencyPicker({ value, onChange }: CurrencyPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DEFAULT_CURRENCIES;
    return DEFAULT_CURRENCIES.filter(
      (code) =>
        code.toLowerCase().includes(q) ||
        getCurrencyName(code).toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search currency…"
        aria-label="Search currency"
        style={{
          minHeight: '44px',
          padding: '0 var(--space-3)',
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-input)',
          color: 'var(--color-text)',
          fontSize: 'var(--text-body)',
          fontFamily: '"DM Sans", sans-serif',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <div
        role="listbox"
        aria-label="Currency"
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          maxHeight: '240px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--color-surface)',
        }}
      >
        {filtered.length === 0 && (
          <div
            style={{
              padding: 'var(--space-4)',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-body)',
              fontFamily: '"DM Sans", sans-serif',
              textAlign: 'center',
            }}
          >
            No results
          </div>
        )}
        {filtered.map((code) => {
          const isSelected = value === code;
          return (
            <button
              key={code}
              role="option"
              aria-selected={isSelected}
              onClick={() => onChange(code)}
              style={{
                minHeight: '44px',
                padding: '0 var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                background: isSelected ? 'var(--color-primary-dim)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--color-border)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: 'var(--text-body)',
                  color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                  minWidth: '3.5ch',
                }}
              >
                {code}
              </span>
              <span
                style={{
                  fontFamily: '"DM Sans", sans-serif',
                  fontSize: 'var(--text-body)',
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getCurrencyName(code)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
