import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { LanguageSetting } from './LanguageSetting';
import { ThemeSetting } from './ThemeSetting';
import { StartupScreenSetting } from './StartupScreenSetting';
import { NotificationSetting } from './NotificationSetting';
import { MainCurrencySetting } from './MainCurrencySetting';
import { BackupSettings } from './BackupSettings';
import { ExportSettings } from './ExportSettings';
import { ComingSoonStub } from '../shared/ComingSoonStub';

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-4) var(--space-2)',
      }}
    >
      <span
        style={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 700,
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function SettingsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: 'var(--color-bg)',
        maxWidth: '480px',
        marginInline: 'auto',
        width: '100%',
      }}
    >
      {/* Top bar */}
      <header
        style={{
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          paddingInline: 'var(--space-4)',
          background: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <button
          aria-label="Go back"
          onClick={() => navigate(-1)}
          style={{
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: 0,
          }}
        >
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>

        <h1
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-heading)',
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          {t('settings.title')}
        </h1>

        {/* Spacer to balance the back button */}
        <div style={{ minWidth: '44px' }} />
      </header>

      {/* Scrollable content */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* General section */}
        <SectionHeader label={t('settings.sections.general')} />

        <LanguageSetting />
        <ThemeSetting />
        <StartupScreenSetting />

        {/* Passcode — Coming soon stub */}
        <ComingSoonStub>
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
              {t('settings.passcode.label')}
            </span>
          </div>
        </ComingSoonStub>

        {/* Notifications section */}
        <SectionHeader label={t('settings.sections.notifications')} />
        <NotificationSetting />

        {/* Data section */}
        <SectionHeader label={t('settings.sections.data')} />
        <MainCurrencySetting />
        <BackupSettings />
        <ExportSettings />

        {/* Bottom safe area padding */}
        <div style={{ height: 'calc(var(--space-8) + env(safe-area-inset-bottom))' }} />
      </div>
    </div>
  );
}
