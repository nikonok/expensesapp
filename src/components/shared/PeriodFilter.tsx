import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import BottomSheet from '../layout/BottomSheet';
import { getPeriodLabel, shiftPeriod, getLocalDateString } from '../../utils/date-utils';
import type { PeriodFilter, PeriodFilterType } from '../../types';

interface PeriodFilterProps {
  value: PeriodFilter;
  onChange: (f: PeriodFilter) => void;
  variant?: 'full' | 'month-only';
}

const FULL_OPTIONS: { type: PeriodFilterType; label: string }[] = [
  { type: 'all', label: 'All time' },
  { type: 'today', label: 'Today' },
  { type: 'day', label: 'Single day' },
  { type: 'week', label: 'Week' },
  { type: 'month', label: 'Month' },
  { type: 'year', label: 'Year' },
  { type: 'custom', label: 'Custom range' },
];

function buildFilterForType(type: PeriodFilterType, currentDate: string): PeriodFilter {
  const today = getLocalDateString();
  switch (type) {
    case 'all':
      return { type: 'all', startDate: today, endDate: today };
    case 'today':
      return { type: 'today', startDate: today, endDate: today };
    case 'day':
      return { type: 'day', startDate: today, endDate: today };
    case 'week':
      return { type: 'week', startDate: currentDate, endDate: currentDate };
    case 'month':
      return { type: 'month', startDate: currentDate, endDate: currentDate };
    case 'year':
      return { type: 'year', startDate: currentDate, endDate: currentDate };
    case 'custom':
      return { type: 'custom', startDate: today, endDate: today };
  }
}

function isNavigable(type: PeriodFilterType): boolean {
  return type === 'today' || type === 'day' || type === 'week' || type === 'month' || type === 'year';
}

export default function PeriodFilter({ value, onChange, variant = 'full' }: PeriodFilterProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(value.startDate);
  const [customTo, setCustomTo] = useState(value.endDate);
  const [pendingCustom, setPendingCustom] = useState(value.type === 'custom');

  const label = getPeriodLabel(value);
  const showArrows = variant === 'month-only' || isNavigable(value.type);
  const isCustomActive = value.type === 'custom';

  function handleChipClick() {
    if (variant === 'month-only') return;
    setCustomFrom(value.startDate);
    setCustomTo(value.endDate);
    setPendingCustom(value.type === 'custom');
    setSheetOpen(true);
  }

  function handleSelectType(type: PeriodFilterType) {
    if (type === 'custom') {
      setPendingCustom(true);
      // Don't close sheet yet — let user fill dates
      return;
    }
    setPendingCustom(false);
    const newFilter = buildFilterForType(type, value.startDate);
    onChange(newFilter);
    setSheetOpen(false);
  }

  function handleApplyCustom() {
    setPendingCustom(false);
    onChange({ type: 'custom', startDate: customFrom, endDate: customTo });
    setSheetOpen(false);
  }

  function handlePrev() {
    onChange(shiftPeriod(value, -1));
  }

  function handleNext() {
    onChange(shiftPeriod(value, 1));
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'var(--space-2)',
      }}
    >
      {/* Main chip */}
      <button
        onClick={handleChipClick}
        aria-haspopup={variant === 'full' ? 'dialog' : undefined}
        aria-expanded={sheetOpen}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '4px',
          height: '36px',
          padding: '0 var(--space-3)',
          background: isCustomActive ? 'var(--color-primary-dim)' : 'var(--color-surface)',
          border: `1px solid ${isCustomActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-chip)',
          cursor: variant === 'month-only' ? 'default' : 'pointer',
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: 'var(--text-body)',
          color: 'var(--color-text)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          minWidth: 0,
          transition: 'background 100ms ease-out, border-color 100ms ease-out',
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {variant === 'full' && (
          <ChevronDown
            size={14}
            strokeWidth={2.5}
            style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }}
          />
        )}
      </button>

      {/* Prev arrow */}
      {showArrows && (
        <button
          onClick={handlePrev}
          aria-label="Previous period"
          style={{
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-chip)',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
            transition: 'background 100ms ease-out, color 100ms ease-out',
          }}
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
        </button>
      )}

      {/* Next arrow */}
      {showArrows && (
        <button
          onClick={handleNext}
          aria-label="Next period"
          style={{
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-chip)',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
            transition: 'background 100ms ease-out, color 100ms ease-out',
          }}
        >
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
      )}

      {/* Bottom sheet — full variant only */}
      {variant === 'full' && (
        <BottomSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="Time period">
          <div style={{ paddingInline: 'var(--space-4)', paddingBottom: 'var(--space-6)' }}>
            {/* Radio list */}
            <div role="radiogroup" aria-label="Period type" style={{ display: 'flex', flexDirection: 'column' }}>
              {FULL_OPTIONS.filter((opt) => opt.type !== 'custom').map((opt) => {
                const isSelected = value.type === opt.type;
                return (
                  <button
                    key={opt.type}
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleSelectType(opt.type)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: '52px',
                      padding: '0 var(--space-1)',
                      background: 'none',
                      border: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      fontFamily: '"DM Sans", sans-serif',
                      fontWeight: 500,
                      fontSize: 'var(--text-body)',
                      color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                      textAlign: 'left',
                    }}
                  >
                    {opt.label}
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

              {/* Custom range option */}
              <button
                role="radio"
                aria-checked={isCustomActive || pendingCustom}
                onClick={() => handleSelectType('custom')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: '52px',
                  padding: '0 var(--space-1)',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 500,
                  fontSize: 'var(--text-body)',
                  color: isCustomActive || pendingCustom ? 'var(--color-primary)' : 'var(--color-text)',
                  textAlign: 'left',
                }}
              >
                Custom range
                {(isCustomActive || pendingCustom) && (
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
            </div>

            {/* Custom date inputs — shown when custom range is active or pending */}
            {(isCustomActive || pendingCustom) && (
              <div
                style={{
                  marginTop: 'var(--space-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-1)',
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: 'var(--text-caption)',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    style={{
                      minHeight: '44px',
                      padding: '0 var(--space-3)',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-input)',
                      color: 'var(--color-text)',
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 'var(--text-body)',
                      colorScheme: 'dark',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />
                </label>

                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-1)',
                    fontFamily: '"DM Sans", sans-serif',
                    fontSize: 'var(--text-caption)',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    style={{
                      minHeight: '44px',
                      padding: '0 var(--space-3)',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-input)',
                      color: 'var(--color-text)',
                      fontFamily: '"DM Sans", sans-serif',
                      fontSize: 'var(--text-body)',
                      colorScheme: 'dark',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />
                </label>

                <button
                  onClick={handleApplyCustom}
                  disabled={!customFrom || !customTo}
                  style={{
                    minHeight: '44px',
                    background: 'var(--color-primary)',
                    border: 'none',
                    borderRadius: 'var(--radius-btn)',
                    color: 'var(--color-bg)',
                    fontFamily: '"DM Sans", sans-serif',
                    fontWeight: 500,
                    fontSize: 'var(--text-body)',
                    cursor: 'pointer',
                    opacity: !customFrom || !customTo ? 0.4 : 1,
                    transition: 'opacity 100ms ease-out',
                  }}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
