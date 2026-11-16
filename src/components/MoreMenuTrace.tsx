// i18n-exempt-file: a diagnostic read off a phone, shown only with ?moreTrace=1.
"use client";

import { useEffect, useState } from "react";

/**
 * **What the phone's More menu sees, on screen** (Aaron, 2026-11-15: on an
 * iPhone it flashes open and closes). Add `?moreTrace=1` to a staff address,
 * tap More, and the last events show at the top with their times: taps,
 * clicks, scrolls, resizes, and each change of More's state. A tag and twelve
 * characters of a label per line; nothing is sent anywhere.
 */
export function MoreMenuTrace() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const t0 = performance.now();
    const log = (what: string, target?: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      const label = el ? `${el.tagName} ${(el.textContent ?? "").trim().slice(0, 12)}` : "";
      setLines((was) => [
        ...was.slice(-29),
        `${Math.round(performance.now() - t0)}ms ${what} ${label}`,
      ]);
    };
    const events = ["pointerdown", "touchend", "click", "scroll", "resize", "blur", "focus"];
    const on = (e: Event) => log(e.type, e.target);
    for (const type of events) window.addEventListener(type, on, true);
    const observer = new MutationObserver((muts) => {
      for (const m of muts)
        log(`aria-expanded=${(m.target as Element).getAttribute("aria-expanded")}`, m.target);
    });
    observer.observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    return () => {
      for (const type of events) window.removeEventListener(type, on, true);
      observer.disconnect();
    };
  }, []);
  return (
    <pre className="fixed inset-x-0 top-0 z-50 max-h-[45vh] overflow-y-auto bg-foreground/90 p-2 text-[10px] leading-tight text-background">
      {lines.join("\n")}
    </pre>
  );
}
