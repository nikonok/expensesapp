import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalDateString } from '../../utils/date-utils';
import PeriodFilterComponent from '../shared/PeriodFilter';
import { ComingSoonStub } from '../shared/ComingSoonStub';
import type { PeriodFilter } from '../../types';

export function ExportSettings() {
  const { t } = useTranslation();
  const today = getLocalDateString();

  const [period, setPeriod] = useState<PeriodFilter>({
    type: 'month',
    startDate: today,
    endDate: today,
  });

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

      <ComingSoonStub>
        <button
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
            cursor: 'pointer',
          }}
        >
          {t('settings.export.button')}
        </button>
      </ComingSoonStub>
    </div>
  );
}
