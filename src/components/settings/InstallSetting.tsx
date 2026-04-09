import { useTranslation } from 'react-i18next';
import { ArrowDownToLine } from 'lucide-react';
import { useInstallPrompt } from '../../hooks/use-install-prompt';

export function InstallSetting() {
  const { t } = useTranslation();
  const { canInstall, install } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <button
      onClick={() => { void install(); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: '52px',
        width: '100%',
        padding: '0 var(--space-4)',
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: '1px solid var(--color-border)',
        background: 'none',
        cursor: 'pointer',
        textAlign: 'left',
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
        {t('settings.installApp.label')}
      </span>
      <ArrowDownToLine size={18} strokeWidth={1.5} color="var(--color-primary)" />
    </button>
  );
}
