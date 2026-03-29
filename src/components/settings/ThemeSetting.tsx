import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../shared/ConfirmDialog';

export function ThemeSetting() {
  const { t } = useTranslation();
  const [showLightDialog, setShowLightDialog] = useState(false);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '52px',
          padding: '0 var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
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
          {t('settings.theme.label')}
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {/* Dark — active */}
          <button
            aria-pressed={true}
            style={{
              minHeight: '36px',
              padding: '0 var(--space-3)',
              background: 'var(--color-primary-dim)',
              border: '1px solid var(--color-primary)',
              borderRadius: 'var(--radius-chip)',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              color: 'var(--color-primary)',
              cursor: 'default',
            }}
          >
            {t('settings.theme.dark')}
          </button>

          {/* Light — triggers humor dialog */}
          <button
            aria-pressed={false}
            onClick={() => setShowLightDialog(true)}
            style={{
              minHeight: '36px',
              padding: '0 var(--space-3)',
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-chip)',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            {t('settings.theme.light')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showLightDialog}
        title={t('settings.theme.light')}
        body={t('settings.theme.lightError')}
        confirmLabel="OK"
        onConfirm={() => setShowLightDialog(false)}
        onCancel={() => setShowLightDialog(false)}
        variant="default"
      />
    </>
  );
}
