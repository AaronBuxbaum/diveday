"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";

const storageKey = "diveday:form-scroll";

/**
 * Server-action redirects refresh the current route, which normally puts the
 * viewport back at the top. Remember the viewport for same-page form actions;
 * true navigations naturally ignore the record because their path changes.
 */
export function PreserveFormScroll() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    function rememberPosition(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.dataset.scrollReset === "true") return;
      sessionStorage.setItem(storageKey, JSON.stringify({ pathname, y: window.scrollY }));
    }

    document.addEventListener("submit", rememberPosition);
    return () => document.removeEventListener("submit", rememberPosition);
  }, [pathname]);

  // Search params are intentionally a dependency: notices from server actions
  // change them while leaving this persistent shop layout mounted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see explanation above
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;
    sessionStorage.removeItem(storageKey);
    const position = JSON.parse(saved) as { pathname?: string; y?: number };
    if (position.pathname === pathname && typeof position.y === "number") {
      requestAnimationFrame(() => window.scrollTo({ top: position.y, behavior: "instant" }));
    }
  }, [pathname, searchParams]);

  return null;
}
