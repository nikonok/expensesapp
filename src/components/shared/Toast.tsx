import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastVariant = 'info' | 'success' | 'error' | 'coming-soon';

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
  visible: boolean;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, variant: ToastVariant = 'info', duration?: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (outTimerRef.current) clearTimeout(outTimerRef.current);

    const id = ++nextId;
    const dismissAfter = duration ?? (variant === 'coming-soon' ? 1500 : 3000);

    setToast({ id, message, variant, visible: true });

    timerRef.current = setTimeout(() => {
      setToast((prev) => (prev?.id === id ? { ...prev, visible: false } : prev));
      outTimerRef.current = setTimeout(() => {
        setToast((prev) => (prev?.id === id ? null : prev));
      }, 200);
    }, dismissAfter);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastContainer toast={toast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

function ToastContainer({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'calc(64px + env(safe-area-inset-bottom) + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '320px',
        width: 'calc(100% - 32px)',
        zIndex: 'var(--z-toast)',
        pointerEvents: 'none',
      }}
    >
      <div
        key={toast.id}
        style={{
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          padding: 'var(--space-3) var(--space-4)',
          fontFamily: '"DM Sans", sans-serif',
          fontSize: 'var(--text-body)',
          color: 'var(--color-text)',
          animation: toast.visible
            ? 'toast-in 200ms ease-out forwards'
            : 'toast-out 150ms ease-out forwards',
        }}
      >
        {toast.message}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes toast-out {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(8px); }
        }
      `}</style>
    </div>
  );
}
