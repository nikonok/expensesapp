import type { ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { useNavigate } from 'react-router';

interface TopBarProps {
  title: string;
  rightSlot?: ReactNode;
}

export default function TopBar({ title, rightSlot }: TopBarProps) {
  const navigate = useNavigate();

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
        }}
      >
        {rightSlot}
      </div>
    </header>
  );
}
