import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type ToastVariant = "info" | "success" | "error" | "coming-soon" | "warning";

/**
 * Module-level helper for code that can't use the `useToast` hook (e.g.
 * the global `apiFetch` interceptor in `services/auth/client.ts`). Fires a
 * window CustomEvent that the active `ToastProvider` listens for. No-op when
 * no provider is mounted (e.g. during unit tests).
 */
export function toast(message: string, variant: ToastVariant = "info", duration?: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("toast", { detail: { message, variant, duration } }));
}

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

  const show = useCallback((message: string, variant: ToastVariant = "info", duration?: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (outTimerRef.current) clearTimeout(outTimerRef.current);

    const id = ++nextId;
    const dismissAfter = duration ?? (variant === "coming-soon" ? 1500 : 3000);

    setToast({ id, message, variant, visible: true });

    timerRef.current = setTimeout(() => {
      setToast((prev) => (prev?.id === id ? { ...prev, visible: false } : prev));
      outTimerRef.current = setTimeout(() => {
        setToast((prev) => (prev?.id === id ? null : prev));
      }, 200);
    }, dismissAfter);
  }, []);

  // Subscribe to module-level `toast()` events so non-React code (e.g. the
  // global apiFetch 429 interceptor) can pop a toast without holding a ref to
  // the provider's `show`.
  useEffect(() => {
    function handler(e: Event) {
      const detail = (
        e as CustomEvent<{
          message: string;
          variant?: ToastVariant;
          duration?: number;
        }>
      ).detail;
      if (!detail || typeof detail.message !== "string") return;
      show(detail.message, detail.variant ?? "info", detail.duration);
    }
    window.addEventListener("toast", handler);
    return () => window.removeEventListener("toast", handler);
  }, [show]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastContainer toast={toast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const VARIANT_BORDER: Record<ToastVariant, string> = {
  error: "var(--color-expense)",
  success: "var(--color-income)",
  info: "var(--color-border-strong)",
  warning: "var(--color-warning, var(--color-expense))",
  "coming-soon": "var(--color-border-strong)",
};

function ToastContainer({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "calc(64px + env(safe-area-inset-bottom) + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "320px",
        width: "calc(100% - 32px)",
        zIndex: "var(--z-toast)",
        pointerEvents: "none",
      }}
    >
      <div
        key={toast.id}
        style={{
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
          borderLeft: `3px solid ${VARIANT_BORDER[toast.variant]}`,
          borderRadius: "12px",
          padding: "var(--space-3) var(--space-4)",
          fontFamily: '"DM Sans", sans-serif',
          fontSize: "var(--text-body)",
          color: "var(--color-text)",
          animation: toast.visible
            ? "toast-in 200ms ease-out forwards"
            : "toast-out 150ms ease-out forwards",
        }}
      >
        {toast.message}
      </div>
    </div>
  );
}
