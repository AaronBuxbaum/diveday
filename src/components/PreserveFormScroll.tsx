"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect } from "react";

const storageKey = "diveday:form-scroll";

/**
 * The page identity this component stores, as a number rather than the path
 * itself. One of the three surfaces that mount this is `/ready/<token>`, whose
 * *pathname is the credential*
 * (docs/engineering/capability-telemetry-runbook.md) — and the only question
 * ever asked of the stored value is "is this the page I submitted from?",
 * which a hash answers exactly as well. djb2, not a crypto digest: this runs
 * inside a `useLayoutEffect` that must read and act in the same frame, so the
 * async web-crypto API is unavailable to it, and there is nothing to defend
 * against beyond leaving a live capability sitting in storage.
 */
function pageKey(pathname: string): number {
  let hash = 5381;
  for (let i = 0; i < pathname.length; i += 1) {
    hash = ((hash << 5) + hash + pathname.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Server-action redirects refresh the current route, which normally puts the
 * viewport back at the top. Remember the viewport for same-page form actions;
 * true navigations naturally ignore the record because their path changes.
 *
 * Mounted once, in the root layout, so every route gets this for free — it
 * used to be mounted separately in each of the staff shop shell, the public
 * shop shell, and the trip-prep "ready" route, which meant a new bearer-token
 * or account-lifecycle route (password reset, a recap form, an invite accept)
 * silently had no scroll preservation until someone remembered to add it here
 * too. The boundary is owned by this component rather than by whatever mounts
 * it because it is a property of this component, not of where it is mounted:
 * `usePathname()`/`useSearchParams()` read URL data, which under Cache
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
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ page: pageKey(pathname), y: window.scrollY }),
      );
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
    // Parsed, not cast: sessionStorage is outside our control (an old tab, an
    // extension), and a throw here would take the whole shell's render with it.
    let position: unknown;
    try {
      position = JSON.parse(saved);
    } catch {
      return;
    }
    if (typeof position !== "object" || position === null) return;
    const { page, y } = position as { page?: unknown; y?: unknown };
    if (page === pageKey(pathname) && typeof y === "number") {
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
    }
  }, [pathname, searchParams]);

  return null;
}
