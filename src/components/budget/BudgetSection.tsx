import { BudgetCard, type BudgetCardData } from './BudgetCard';

interface BudgetSectionProps {
  title: string;
  items: BudgetCardData[];
  month: string; // "YYYY-MM"
  type: 'category' | 'account';
  isLoading?: boolean;
}

function sortItems(items: BudgetCardData[]): BudgetCardData[] {
  const budgeted = items
    .filter((i) => i.planned != null && i.planned > 0)
    .sort((a, b) => (b.planned ?? 0) - (a.planned ?? 0));

  const unbudgeted = items
    .filter((i) => i.planned == null || i.planned === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...budgeted, ...unbudgeted];
}

export function BudgetSection({ title, items, month, type, isLoading }: BudgetSectionProps) {
  if (isLoading) {
    return (
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <h2
          style={{
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-subheading)',
            color: 'var(--color-text-secondary)',
            margin: '0 0 var(--space-3)',
            paddingInline: 'var(--space-4)',
          }}
        >
          {title}
        </h2>
        <div
          style={{
            height: '60px',
            margin: '0 var(--space-4)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--color-surface)',
            opacity: 0.5,
          }}
        />
      </section>
    );
  }

  if (items.length === 0) return null;

  const sorted = sortItems(items);

  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      <h2
        style={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 700,
          fontSize: 'var(--text-subheading)',
          color: 'var(--color-text-secondary)',
          margin: '0 0 var(--space-3)',
          paddingInline: 'var(--space-4)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {title}
      </h2>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          paddingInline: 'var(--space-4)',
        }}
      >
        {sorted.map((item) => (
          <BudgetCard key={item.id} item={item} type={type} month={month} />
        ))}
      </div>
    </section>
  );
}
