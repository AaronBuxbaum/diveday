"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect } from "react";

const storageKey = "diveday:form-scroll";

/**
 * Server-action redirects refresh the current route, which normally puts the
 * viewport back at the top. Remember the viewport for same-page form actions;
 * true navigations naturally ignore the record because their path changes.
 *
 * The boundary is here rather than at the two call sites (the staff and public
 * shop shells) because it is a property of this component, not of where it is
 * mounted: `usePathname()`/`useSearchParams()` read URL data, which under Cache
 * Components is only available at runtime, so an unwrapped call takes the whole
 * route's static shell with it (`blocking-prerender-client-hook`). Owning the
 * boundary means a shell can render this without knowing that. The fallback is
 * `null` because so is the rendered output — this component is two effects and
 * nothing else, so there is no layout to hold and nothing to see either way.
 */
export function PreserveFormScroll() {
  return (
    <Suspense fallback={null}>
      <PreserveFormScrollEffects />
    </Suspense>
  );
}

function PreserveFormScrollEffects() {
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
