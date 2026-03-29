import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarPickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toDateString(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function CalendarPicker({ value, onChange }: CalendarPickerProps) {
  const today = new Date();
  const todayStr = toDateString(today.getFullYear(), today.getMonth(), today.getDate());

  // Parse current value to get initially displayed month
  const parsedValue = value ? new Date(value + 'T00:00:00') : today;
  const [viewYear, setViewYear] = useState(parsedValue.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsedValue.getMonth()); // 0-indexed

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Build grid: weeks x 7 cells, starting from Sunday
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Total cells needed (pad to full weeks)
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDayOfMonth + 1;
    cells.push(dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        userSelect: 'none',
      }}
    >
      {/* Month navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={handlePrevMonth}
          aria-label="Previous month"
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
            borderRadius: 'var(--radius-btn)',
          }}
        >
          <ChevronLeft size={18} />
        </button>

        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
            color: 'var(--color-text)',
          }}
        >
          {monthNames[viewMonth]} {viewYear}
        </span>

        <button
          onClick={handleNextMonth}
          aria-label="Next month"
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
            borderRadius: 'var(--radius-btn)',
          }}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '2px',
        }}
      >
        {DAY_LABELS.map((label) => (
          <div
            key={label}
            style={{
              textAlign: 'center',
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-secondary)',
              paddingBlock: '4px',
            }}
          >
            {label}
          </div>
        ))}

        {/* Day cells */}
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} style={{ minHeight: '44px' }} />;
          }
          const dateStr = toDateString(viewYear, viewMonth, day);
          const isSelected = dateStr === value;
          const isToday = dateStr === todayStr;

          return (
            <button
              key={dateStr}
              onClick={() => onChange(dateStr)}
              aria-label={dateStr}
              aria-pressed={isSelected}
              style={{
                minWidth: '44px',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isSelected
                  ? 'var(--color-primary)'
                  : 'none',
                border: isToday && !isSelected
                  ? '1px solid var(--color-primary)'
                  : '1px solid transparent',
                borderRadius: '50%',
                cursor: 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 'var(--text-caption)',
                fontWeight: isSelected ? 600 : 500,
                color: isSelected
                  ? 'var(--color-bg)'
                  : isToday
                    ? 'var(--color-primary)'
                    : 'var(--color-text)',
                transition: 'background 100ms, color 100ms',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
