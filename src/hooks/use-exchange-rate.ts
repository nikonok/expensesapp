interface ExchangeRateResult {
  rate: number | null;
  isLoading: boolean;
}

export function useExchangeRate(_from: string, _to: string): ExchangeRateResult {
  return { rate: null, isLoading: false };
}
