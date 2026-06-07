export function formatAmount(amount: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

export function formatAmountNoSymbol(amount: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

/**
 * Convert an integer minor-unit amount in one currency to integer minor units
 * in another currency, given the FX rate (1 unit of `from` = `rate` units of `to`).
 *
 * Stored minor units always use a /100 scale regardless of the currency's
 * native decimal count (this is an app-wide convention — see CLAUDE.md).
 * Therefore both legs share the same scale and a simple `amount * rate` round
 * is correct. The optional dp arguments are accepted for symmetry with the
 * upcoming sync engine and to allow future migration to native scales without
 * changing the call sites.
 */
export function convertAmount(
  amount: number,
  rate: number,
  _fromDecimalPlaces?: number,
  _toDecimalPlaces?: number,
): number {
  void _fromDecimalPlaces;
  void _toDecimalPlaces;
  return Math.round(amount * rate);
}

export function getCurrencySymbol(currency: string, locale?: string): string {
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .formatToParts(0)
    .find((part) => part.type === "currency");
  return formatted?.value ?? currency;
}

const _decimalPlacesCache = new Map<string, number>();

export function getCurrencyDecimalPlaces(currency: string): number {
  if (_decimalPlacesCache.has(currency)) {
    return _decimalPlacesCache.get(currency)!;
  }
  try {
    const dp =
      new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
        .minimumFractionDigits ?? 2;
    _decimalPlacesCache.set(currency, dp);
    return dp;
  } catch {
    return 2;
  }
}
