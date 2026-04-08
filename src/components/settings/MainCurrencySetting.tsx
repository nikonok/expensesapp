import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings-store';
import { exchangeRateService } from '../../services/exchange-rate.service';
import { CurrencyPicker } from '../shared/CurrencyPicker';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import BottomSheet from '../layout/BottomSheet';
import { useToast } from '../shared/Toast';

export function MainCurrencySetting() {
  const { t } = useTranslation();
  const { mainCurrency, update } = useSettingsStore();
  const { show } = useToast();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  function handlePickerChange(currency: string) {
    if (currency === mainCurrency) {
      setPickerOpen(false);
      return;
    }
    setPendingCurrency(currency);
    setPickerOpen(false);
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    if (!pendingCurrency) return;
    setConfirmOpen(false);
    setProgress(0);

    try {
      await exchangeRateService.recalculateAllMainCurrencyAmounts(
        pendingCurrency,
        (done, total) => {
          setProgress(total === 0 ? 100 : Math.round((done / total) * 100));
        },
      );
      await update('mainCurrency', pendingCurrency);
      setProgress(null);
      show(t('settings.export.complete'), 'success');
    } catch (err: unknown) {
      setProgress(null);
      const message =
        err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(message);
      setErrorOpen(true);
    } finally {
      setPendingCurrency(null);
    }
  }

  function handleCancelConfirm() {
    setConfirmOpen(false);
    setPendingCurrency(null);
  }

  return (
    <>
      <button
        onClick={() => setPickerOpen(true)}
        disabled={progress !== null}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '52px',
          width: '100%',
          padding: '0 var(--space-4)',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--color-border)',
          cursor: progress !== null ? 'not-allowed' : 'pointer',
          color: 'var(--color-text)',
          opacity: progress !== null ? 0.6 : 1,
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
          }}
        >
          {t('settings.mainCurrency.label')}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          {progress !== null ? (
            <span
              style={{
                fontFamily: '"DM Sans", sans-serif',
                fontSize: 'var(--text-body)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {t('settings.mainCurrency.recalculating')} {progress}%
            </span>
          ) : (
            <>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 600,
                  fontSize: 'var(--text-body)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {mainCurrency}
              </span>
              <ChevronRight
                size={16}
                strokeWidth={2}
                style={{ color: 'var(--color-text-secondary)' }}
              />
            </>
          )}
        </span>
      </button>

      {/* Progress bar */}
      {progress !== null && (
        <div
          style={{
            height: '2px',
            background: 'var(--color-border)',
            borderRadius: '1px',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'var(--color-primary)',
              borderRadius: '1px',
              transition: 'width 150ms ease-out',
              boxShadow: '0 0 8px var(--color-primary)',
            }}
          />
        </div>
      )}

      {/* Currency picker sheet */}
      <BottomSheet
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('settings.mainCurrency.label')}
      >
        <div style={{ paddingInline: 'var(--space-4)', paddingBottom: 'var(--space-6)' }}>
          <CurrencyPicker value={mainCurrency} onChange={handlePickerChange} variant="inline" />
        </div>
      </BottomSheet>

      {/* Confirm dialog */}
      <ConfirmDialog
        isOpen={confirmOpen}
        title={t('settings.mainCurrency.label')}
        body={t('settings.mainCurrency.changeConfirm', {
          currency: pendingCurrency ?? '',
        })}
        confirmLabel="Confirm"
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
        variant="default"
      />

      {/* Error dialog for missing rates */}
      <ConfirmDialog
        isOpen={errorOpen}
        title="Error"
        body={errorMsg}
        confirmLabel="OK"
        onConfirm={() => setErrorOpen(false)}
        onCancel={() => setErrorOpen(false)}
        variant="destructive"
      />
    </>
  );
}
