// useIsMobile — returns true when the viewport is narrower than `breakpoint`
// (default 600px). Uses window.matchMedia and subscribes to changes so layout
// reacts to rotation / window resize without a manual refresh.
//
// SSR-safe: returns `false` when `window` is undefined (no DOM yet).

import { useEffect, useState } from "react";

export function useIsMobile(breakpoint = 600): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    // Sync once on mount in case state was stale (e.g. fast resize before effect).
    setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return isMobile;
}
