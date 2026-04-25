import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// ── Hardware-back / gesture-back stack ──────────────────────────────────────
// Each open BottomSheet pushes one history entry and registers a LIFO close
// callback. A single global popstate listener pops the topmost callback,
// giving hardware-back LIFO behavior across stacked sheets.
type CloseEntry = { id: number; close: () => boolean };
const closeStack: CloseEntry[] = [];
let nextId = 0;
// Counter (not boolean) to safely skip the popstate fired by our own
// history.back() calls — handles rapid simultaneous closes correctly.
let skipCount = 0;

function handleGlobalPopState() {
  if (skipCount > 0) {
    skipCount = Math.max(0, skipCount - 1);
    return;
  }
  const top = closeStack[closeStack.length - 1];
  if (!top) return;
  const intercepted = top.close();
  if (intercepted) {
    // close() handled an inner layer (e.g. numpad) — re-push so the next
    // back press still finds this sheet's entry.
    history.pushState(null, "", window.location.href);
  } else {
    closeStack.pop();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", handleGlobalPopState);
}

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Override backdrop tap. When provided, tapping outside the sheet calls
   *  this instead of onClose. Use to close an inner layer without closing
   *  the whole sheet. */
  onBackdropClick?: () => void;
  /** Called on hardware-back / drag-to-dismiss / Escape before onClose.
   *  Return true to intercept (inner layer closed); return false/undefined to
   *  let onClose proceed normally. */
  onInterceptClose?: () => boolean;
  title?: string;
  children: ReactNode;
}

export default function BottomSheet({
  isOpen,
  onClose,
  onBackdropClick,
  onInterceptClose,
  title,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [translateY, setTranslateY] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);

  // Drag state
  const dragStartY = useRef(0);
  const currentDragY = useRef(0);
  const isDragging = useRef(false);

  // Refs to latest callbacks — avoids stale closures inside the history stack
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onInterceptCloseRef = useRef(onInterceptClose);
  onInterceptCloseRef.current = onInterceptClose;
  const sheetIdRef = useRef<number | null>(null);

  // Push a history entry when opening; clean it up on close/unmount
  useEffect(() => {
    if (!isOpen) return;
    const id = nextId++;
    sheetIdRef.current = id;
    closeStack.push({
      id,
      close: () => {
        if (onInterceptCloseRef.current?.()) return true;
        onCloseRef.current();
        return false;
      },
    });
    history.pushState(null, "", window.location.href);

    return () => {
      const idx = closeStack.findIndex((e) => e.id === id);
      if (idx !== -1) {
        // Normal programmatic close (button/save) — pop our stack entry and
        // neutralise the history entry we pushed in-place (no popstate fired).
        closeStack.splice(idx, 1);
        history.replaceState(null, "", window.location.href);
      }
      // If idx === -1, hardware back already popped the entry and consumed
      // the history entry — nothing to do here.
      sheetIdRef.current = null;
    };
  }, [isOpen]);

  // Focus trap: save previous focus, move focus into sheet, restore on close
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement;
    requestAnimationFrame(() => {
      const focusable = sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      focusable?.focus();
    });
    return () => {
      previousFocus?.focus();
    };
  }, [isOpen]);

  // Focus trap: constrain Tab inside sheet
  useEffect(() => {
    if (!isOpen) return;
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusables = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  // Escape key closes the sheet (with intercept support)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onInterceptCloseRef.current?.()) return;
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Open/close animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      // Trigger animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimatingIn(true);
        });
      });
    } else {
      setIsAnimatingIn(false);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTranslateY(0);
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // visualViewport resize: keep sheet above keyboard
  useEffect(() => {
    if (!isOpen) return;

    const vv = window.visualViewport;
    if (!vv) return;

    // Capture ref now so cleanup doesn't dereference a null ref on unmount
    const sheetEl = sheetRef.current;

    const handleResize = () => {
      const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
      if (sheetEl) {
        sheetEl.style.bottom = `${Math.max(0, keyboardHeight)}px`;
        // Scroll the focused input into view in case the keyboard height
        // calculation leaves it partially obscured
        const focused = sheetEl.querySelector(":focus") as HTMLElement | null;
        focused?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };

    // Delay attaching listeners until after the open animation (300ms) so
    // the initial keyboard resize doesn't race with the slide-up animation.
    // Run handleResize() immediately after the delay to catch keyboards that
    // opened during the animation window (e.g. via autoFocus).
    const delayTimer = setTimeout(() => {
      vv.addEventListener("resize", handleResize);
      vv.addEventListener("scroll", handleResize);
      handleResize();
    }, 300);

    return () => {
      clearTimeout(delayTimer);
      vv.removeEventListener("resize", handleResize);
      vv.removeEventListener("scroll", handleResize);
      if (sheetEl) {
        sheetEl.style.bottom = "";
      }
    };
  }, [isOpen]);

  // focusin fallback: scroll the focused input into view during the 300ms
  // animation window before the visualViewport resize listener attaches.
  // Auto-removes after 650ms (300ms open animation + 350ms scroll delay).
  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    const handleFocusIn = (e: FocusEvent) => {
      if (!active) return;
      const target = e.target as HTMLElement;
      if (sheetRef.current?.contains(target) && target.tagName !== "BUTTON") {
        setTimeout(() => {
          target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 350);
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    const cancelTimer = setTimeout(() => {
      active = false;
      document.removeEventListener("focusin", handleFocusIn);
    }, 650);

    return () => {
      clearTimeout(cancelTimer);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [isOpen]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    currentDragY.current = 0;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const delta = e.clientY - dragStartY.current;
    if (delta < 0) return; // No pulling up beyond origin
    currentDragY.current = delta;
    setTranslateY(delta);
  };

  const handlePointerUp = () => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const sheetHeight = sheetRef.current?.offsetHeight ?? 300;
    if (currentDragY.current >= sheetHeight * 0.4) {
      if (onInterceptCloseRef.current?.()) {
        setTranslateY(0);
      } else {
        onCloseRef.current();
      }
    } else {
      setTranslateY(0);
    }
  };

  if (!isVisible) return null;

  const sheetTranslateY = isAnimatingIn ? translateY : "100%";

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onBackdropClick ?? onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          zIndex: "var(--z-overlay)",
          opacity: isAnimatingIn ? 1 : 0,
          transition: "opacity 200ms ease-out",
        }}
      />

      {/* Sheet panel */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Dialog"}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: "var(--z-sheet)",
          background: "var(--color-surface-raised)",
          borderRadius: "var(--radius-sheet) var(--radius-sheet) 0 0",
          transform: `translateY(${typeof sheetTranslateY === "number" ? `${sheetTranslateY}px` : sheetTranslateY})`,
          transition: isDragging.current
            ? "none"
            : isAnimatingIn
              ? "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)"
              : "transform 220ms ease-in",
          maxWidth: "480px",
          marginInline: "auto",
          maxHeight: "90dvh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Drag handle */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            paddingTop: "12px",
            paddingBottom: "8px",
            display: "flex",
            justifyContent: "center",
            flexShrink: 0,
            cursor: "grab",
            touchAction: "none",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "4px",
              borderRadius: "9999px",
              background: "var(--color-border-strong)",
            }}
          />
        </div>

        {/* Title */}
        {title && (
          <div
            style={{
              paddingInline: "var(--space-4)",
              paddingBottom: "var(--space-3)",
              flexShrink: 0,
            }}
          >
            <h2
              style={{
                fontFamily: "Syne, sans-serif",
                fontWeight: 700,
                fontSize: "var(--text-heading)",
                color: "var(--color-text)",
                margin: 0,
              }}
            >
              {title}
            </h2>
          </div>
        )}

        {/* Content */}
        <div style={{ overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </>,
    document.body,
  );
}
