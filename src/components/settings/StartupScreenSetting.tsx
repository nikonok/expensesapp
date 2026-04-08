import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings-store';
import BottomSheet from '../layout/BottomSheet';
import { useToast } from '../shared/Toast';
import type { TabName } from '../../types';

const SCREENS: { value: TabName; label: string }[] = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'categories', label: 'Categories' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'budget', label: 'Budget' },
  { value: 'overview', label: 'Overview' },
];

export function StartupScreenSetting() {
  const { t } = useTranslation();
  const { startupScreen, update } = useSettingsStore();
  const { show: showToast } = useToast();
  const [open, setOpen] = useState(false);

  const currentLabel =
    SCREENS.find((s) => s.value === startupScreen)?.label ?? 'Transactions';

  async function handleSelect(value: TabName) {
    try {
      await update('startupScreen', value);
      setOpen(false);
    } catch {
      showToast('Failed to save setting', 'error');
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
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
          cursor: 'pointer',
          color: 'var(--color-text)',
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
          }}
        >
          {t('settings.startupScreen.label')}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontFamily: '"DM Sans", sans-serif',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {currentLabel}
          <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
        </span>
      </button>

      <BottomSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('settings.startupScreen.label')}
      >
        <div
          role="radiogroup"
          aria-label={t('settings.startupScreen.label')}
          style={{ paddingInline: 'var(--space-4)', paddingBottom: 'var(--space-6)' }}
        >
          {SCREENS.map((screen) => {
            const isSelected = startupScreen === screen.value;
            return (
              <button
                key={screen.value}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelect(screen.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: '52px',
                  width: '100%',
                  padding: '0 var(--space-1)',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 500,
                  fontSize: 'var(--text-body)',
                  color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                  textAlign: 'left',
                }}
              >
                {screen.label}
                {isSelected && (
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--color-primary)',
                      flexShrink: 0,
                      boxShadow: '0 0 6px var(--color-primary)',
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
