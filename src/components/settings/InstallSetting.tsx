import { useTranslation } from 'react-i18next';
import { ArrowDownToLine } from 'lucide-react';
import { useInstallPrompt } from '../../hooks/use-install-prompt';

export function InstallSetting() {
  const { t } = useTranslation();
  const { canInstall, install } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <div
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <button
        onClick={() => { void install(); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          minHeight: '52px',
          width: '100%',
          padding: '0 var(--space-4)',
          border: 'none',
          borderRadius: 'var(--radius-btn)',
          background: 'var(--color-primary)',
          color: 'var(--color-bg)',
          cursor: 'pointer',
          boxShadow: '0 4px 16px oklch(72% 0.22 210 / 30%)',
        }}
      >
        <ArrowDownToLine size={18} strokeWidth={2} />
        <span
          style={{
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: '1rem',
            letterSpacing: '0.05em',
          }}
        >
          {t('settings.installApp.label')}
        </span>
      </button>
    </div>
  );
}
