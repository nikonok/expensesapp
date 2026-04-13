import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { getLocalDateString, parsePeriodFilter } from '../../utils/date-utils';
import PeriodFilterComponent from '../shared/PeriodFilter';
import { useSettingsStore } from '../../stores/settings-store';
import { exportService } from '../../services/export.service';
import { useToast } from '../shared/Toast';
import type { PeriodFilter } from '../../types';

export function ExportSettings() {
  const { t } = useTranslation();
  const { show } = useToast();
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);
  const today = getLocalDateString();

  const [period, setPeriod] = useState<PeriodFilter>({
    type: 'month',
    startDate: today,
    endDate: today,
  });
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { start, end } = parsePeriodFilter(period);
      const startDate = format(start, 'yyyy-MM-dd');
      const endDate = format(end, 'yyyy-MM-dd');
      await exportService.exportTransactions(startDate, endDate, mainCurrency);
      show(t('settings.export.complete'), 'success');
    } catch {
      show(t('errors.generic'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <span
        style={{
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: 'var(--text-body)',
          color: 'var(--color-text)',
        }}
      >
        {t('settings.export.label')}
      </span>

      <PeriodFilterComponent value={period} onChange={setPeriod} variant="full" />

      <button
        onClick={handleExport}
        disabled={isExporting}
        style={{
          minHeight: '44px',
          width: '100%',
          background: 'var(--color-primary)',
          border: 'none',
          borderRadius: 'var(--radius-btn)',
          color: 'var(--color-bg)',
          fontFamily: '"DM Sans", sans-serif',
          fontWeight: 500,
          fontSize: 'var(--text-body)',
          cursor: isExporting ? 'not-allowed' : 'pointer',
          opacity: isExporting ? 0.6 : 1,
        }}
      >
        {t('settings.export.button')}
      </button>
    </div>
  );
}
