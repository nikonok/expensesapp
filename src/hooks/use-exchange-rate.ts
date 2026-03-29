import { useState, useEffect } from 'react';
import { exchangeRateService } from '../services/exchange-rate.service';

export function useExchangeRate(from: string, to: string) {
  const [rate, setRate] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(from !== to);

  useEffect(() => {
    if (from === to) { setRate(1); setIsLoading(false); return; }
    let cancelled = false;
    setIsLoading(true);
    exchangeRateService.getRate(from, to)
      .then(r => { if (!cancelled) { setRate(r); setIsLoading(false); } })
      .catch(() => { if (!cancelled) { setRate(null); setIsLoading(false); } });
    return () => { cancelled = true; };
  }, [from, to]);

  return { rate, isLoading };
}
