export function formatAmount(amount: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

export function formatAmountNoSymbol(amount: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

export function convertAmount(amount: number, rate: number): number {
  return Math.round(amount * rate);
}

export function getCurrencySymbol(currency: string, locale?: string): string {
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency');
  return formatted?.value ?? currency;
}

const _decimalPlacesCache = new Map<string, number>();

export function getCurrencyDecimalPlaces(currency: string): number {
  if (_decimalPlacesCache.has(currency)) {
    return _decimalPlacesCache.get(currency)!;
  }
  try {
    const dp = new Intl.NumberFormat('en-US', { style: 'currency', currency })
      .resolvedOptions().minimumFractionDigits ?? 2;
    _decimalPlacesCache.set(currency, dp);
    return dp;
  } catch {
    return 2;
  }
}
