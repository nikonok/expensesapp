interface AmountDisplayProps {
  amount: number;
  currency: string;
  type: 'income' | 'expense' | 'transfer' | 'neutral';
  size: 'lg' | 'md' | 'sm';
}

const SIZE_MAP = {
  lg: 'var(--text-amount-lg)',
  md: 'var(--text-amount-md)',
  sm: 'var(--text-amount-sm)',
} as const;

const STYLE_MAP: Record<
  AmountDisplayProps['type'],
  { color: string; textShadow?: string; prefix?: string; opacity?: number }
> = {
  income: {
    color: 'var(--color-income)',
    textShadow: '0 0 12px oklch(73% 0.23 160 / 45%)',
    prefix: '+',
  },
  expense: {
    color: 'var(--color-expense)',
    textShadow: '0 0 12px oklch(62% 0.28 18 / 45%)',
    prefix: '−',
  },
  transfer: {
    color: 'var(--color-transfer)',
    prefix: '⇄',
  },
  neutral: {
    color: 'var(--color-text)',
  },
};

export function AmountDisplay({ amount, currency, type, size }: AmountDisplayProps) {
  const { color, textShadow, prefix, opacity } = STYLE_MAP[type];
  const fontSize = SIZE_MAP[size];

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount) / 100);

  const typeLabel = type === 'income' ? 'income' : type === 'expense' ? 'expense' : type === 'transfer' ? 'transfer' : undefined;
  const accessibleLabel = typeLabel ? `${typeLabel} ${formatted}` : formatted;

  return (
    <span
      aria-label={accessibleLabel}
      style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontWeight: 600,
        fontSize,
        color,
        textShadow,
        opacity,
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '0.1em',
      }}
    >
      {prefix && (
        <span aria-hidden="true" style={{ fontWeight: 500 }}>
          {prefix}
        </span>
      )}
      <span aria-hidden="true">{formatted}</span>
    </span>
  );
}
