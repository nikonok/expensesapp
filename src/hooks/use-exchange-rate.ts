import { useState, useEffect } from 'react';
import { exchangeRateService } from '../services/exchange-rate.service';

export function useExchangeRate(from: string, to: string) {
  const [rate, setRate] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(from !== to);

  useEffect(() => {
    if (from === to) { setRate(1); setIsLoading(false); return; }
    setIsLoading(true);
    exchangeRateService.getRate(from, to)
      .then(r => { setRate(r); setIsLoading(false); })
      .catch(() => { setRate(null); setIsLoading(false); });
  }, [from, to]);

  return { rate, isLoading };
}
