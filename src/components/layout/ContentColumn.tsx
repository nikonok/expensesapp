import type { ReactNode } from 'react';

interface ContentColumnProps {
  children: ReactNode;
}

export default function ContentColumn({ children }: ContentColumnProps) {
  return (
    <main
      style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
        }}
      >
        {children}
      </div>
    </main>
  );
}
