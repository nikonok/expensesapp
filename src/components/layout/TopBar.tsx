import type { ReactNode } from 'react';
import { ArrowDownToLine, Settings, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useInstallPrompt } from '../../hooks/use-install-prompt';

interface TopBarProps {
  title: string;
  rightSlot?: ReactNode;
}

export default function TopBar({ title, rightSlot }: TopBarProps) {
  const navigate = useNavigate();
  const { canInstall, install, dismiss } = useInstallPrompt();

  return (
    <header
      className="app-bar"
      style={{
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        paddingInline: 'var(--space-4)',
        background: 'var(--color-bg)',
        borderBottom: '1px solid transparent',
        position: 'sticky',
        top: 0,
        zIndex: 'var(--z-sticky)',
        flexShrink: 0,
      }}
    >
      <button
        aria-label="Open settings"
        onClick={() => navigate('/settings')}
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
        <Settings size={20} strokeWidth={1.5} />
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
        {title}
      </h1>

      <div
        style={{
          minWidth: '44px',
          minHeight: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 'var(--space-1)',
        }}
      >
        {canInstall ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--color-primary)',
              borderRadius: '999px',
              paddingLeft: '12px',
              paddingRight: '4px',
              height: '32px',
              boxShadow: '0 4px 16px oklch(72% 0.22 210 / 30%)',
            }}
          >
            <button
              onClick={install}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-bg)',
                fontFamily: '"DM Sans", sans-serif',
                fontWeight: 500,
                fontSize: '12px',
                padding: '16px 2px',
                margin: '-16px 0',
                lineHeight: 1,
              }}
            >
              <ArrowDownToLine size={12} strokeWidth={2} />
              <span>Install</span>
            </button>
            <button
              aria-label="Dismiss install prompt"
              onClick={dismiss}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                padding: '12px',
                margin: '-12px',
                boxSizing: 'content-box',
              }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ) : (
          rightSlot
        )}
      </div>
    </header>
  );
}
