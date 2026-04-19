import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { DEFAULT_CURRENCIES } from '../../db/seed';
import { filterCurrencies } from '../../utils/currency-search';

interface CurrencyPickerProps {
  value: string;
  onChange: (v: string) => void;
  variant?: 'dropdown' | 'inline';
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

function CurrencyList({
  value,
  query,
  onSelect,
}: {
  value: string;
  query: string;
  onSelect: (code: string) => void;
}) {
  const filtered = useMemo(
    () => filterCurrencies(DEFAULT_CURRENCIES, query, getCurrencyName),
    [query],
  );

  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, []);

  return (
    <div
      role="listbox"
      aria-label="Currency"
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        flex: 1,
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
            ref={isSelected ? selectedRef : null}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(code)}
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
              flexShrink: 0,
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
  );
}

function InlinePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [query, setQuery] = useState('');
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
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--color-surface)',
          maxHeight: '240px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <CurrencyList value={value} query={query} onSelect={onChange} />
      </div>
    </div>
  );
}

function DropdownPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const open = () => {
    if (isOpen) { close(); return; }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;
    const panelHeight = Math.min(280, Math.max(160, spaceBelow, spaceAbove));
    const openBelow = spaceBelow >= spaceAbove || spaceBelow >= 160;

    setPanelStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight: panelHeight,
      ...(openBelow
        ? { top: rect.bottom + 4 }
        : { bottom: window.innerHeight - rect.top + 4 }),
      zIndex: 350,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-primary)',
      borderRadius: 'var(--radius-card)',
      boxShadow: '0 8px 32px oklch(0% 0 0 / 50%)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const handleSelect = (code: string) => {
    onChange(code);
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={open}
        style={{
          minHeight: '44px',
          padding: '0 var(--space-3)',
          background: 'var(--color-surface-raised)',
          border: `1px solid ${isOpen ? 'var(--color-primary)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-input)',
          color: 'var(--color-text)',
          fontSize: 'var(--text-body)',
          fontFamily: '"DM Sans", sans-serif',
          cursor: 'pointer',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          boxSizing: 'border-box',
          transition: 'border-color 100ms ease-out',
        }}
      >
        <span
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 600,
            color: 'var(--color-primary)',
          }}
        >
          {value}
        </span>
        <span
          style={{
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            textAlign: 'left',
          }}
        >
          {getCurrencyName(value)}
        </span>
        <ChevronDown
          size={16}
          style={{
            color: 'var(--color-text-disabled)',
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms ease-out',
          }}
        />
      </button>

      {isOpen &&
        createPortal(
          <>
            {/* Backdrop for click-outside */}
            <div
              onClick={close}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 349,
              }}
            />
            {/* Dropdown panel */}
            <div style={panelStyle}>
              <div
                style={{
                  padding: 'var(--space-2)',
                  borderBottom: '1px solid var(--color-border)',
                  flexShrink: 0,
                }}
              >
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search currency…"
                  aria-label="Search currency"
                  style={{
                    minHeight: '36px',
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
              </div>
              <CurrencyList value={value} query={query} onSelect={handleSelect} />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

export function CurrencyPicker({ value, onChange, variant = 'dropdown' }: CurrencyPickerProps) {
  if (variant === 'inline') {
    return <InlinePicker value={value} onChange={onChange} />;
  }
  return <DropdownPicker value={value} onChange={onChange} />;
}
