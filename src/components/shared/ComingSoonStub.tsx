import type { ReactNode } from 'react';
import { useToast } from './Toast';

interface ComingSoonStubProps {
  children: ReactNode;
}

export function ComingSoonStub({ children }: ComingSoonStubProps) {
  const { show } = useToast();

  return (
    <div
      aria-disabled="true"
      aria-describedby="coming-soon-label"
      onClick={() => show('Coming soon', 'coming-soon')}
      style={{ position: 'relative', cursor: 'not-allowed' }}
    >
      <span
        id="coming-soon-label"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          borderWidth: 0,
        }}
      >
        Coming soon
      </span>
      <div style={{ opacity: 0.4, pointerEvents: 'none' }}>{children}</div>
    </div>
  );
}
