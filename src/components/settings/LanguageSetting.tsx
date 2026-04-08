import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings-store';
import BottomSheet from '../layout/BottomSheet';
import { useToast } from '../shared/Toast';

const LANGUAGES = [
  { code: 'en', label: 'English' },
];

export function LanguageSetting() {
  const { t, i18n } = useTranslation();
  const { language, update } = useSettingsStore();
  const { show: showToast } = useToast();
  const [open, setOpen] = useState(false);

  const currentLabel = LANGUAGES.find((l) => l.code === language)?.label ?? 'English';

  async function handleSelect(code: string) {
    try {
      await i18n.changeLanguage(code);
      await update('language', code);
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
          {t('settings.language.label')}
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

      <BottomSheet isOpen={open} onClose={() => setOpen(false)} title={t('settings.language.label')}>
        <div style={{ paddingInline: 'var(--space-4)', paddingBottom: 'var(--space-6)' }}>
          {LANGUAGES.map((lang) => {
            const isSelected = language === lang.code;
            return (
              <button
                key={lang.code}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelect(lang.code)}
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
                {lang.label}
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
