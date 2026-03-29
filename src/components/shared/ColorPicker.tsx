import { COLOR_PALETTE } from '../../utils/constants';

interface ColorPickerProps {
  value: string;
  onChange: (v: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))',
        gap: 'var(--space-2)',
      }}
      role="radiogroup"
      aria-label="Color"
    >
      {COLOR_PALETTE.map((swatch) => {
        const isSelected = value === swatch.value || value === `var(${swatch.cssVar})`;
        return (
          <button
            key={swatch.id}
            role="radio"
            aria-checked={isSelected}
            aria-label={`Color ${swatch.id}`}
            onClick={() => onChange(swatch.value)}
            style={{
              width: '44px',
              height: '44px',
              minHeight: '44px',
              borderRadius: '50%',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: 'none',
            }}
          >
            <span
              style={{
                display: 'block',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: swatch.value,
                outline: isSelected
                  ? '2px solid var(--color-primary)'
                  : '2px solid transparent',
                outlineOffset: '2px',
                transition: 'outline-color 100ms ease-out',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
