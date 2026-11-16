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
// Kept outside the component: if the tab bar is torn down and redrawn, the
// trace of what led up to it survives and says so.
const kept: string[] = [];
const t0 = typeof performance === "undefined" ? 0 : performance.now();

export function MoreMenuTrace() {
  const [lines, setLines] = useState<string[]>(kept);
  useEffect(() => {
    const log = (what: string, target?: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      const label = el ? `${el.tagName} ${(el.textContent ?? "").trim().slice(0, 12)}` : "";
      kept.push(`${Math.round(performance.now() - t0)}ms ${what} ${label}`);
      setLines(kept.slice(-30));
    };
    log("TRACE MOUNTED");
    const events = [
      "pointerdown",
      "touchend",
      "click",
      "keydown",
      "scroll",
      "resize",
      "blur",
      "focus",
    ];
    const on = (e: Event) => log(e.type, e.target);
    for (const type of events) window.addEventListener(type, on, true);
    const named = ["popstate", "pagehide", "visibilitychange"];
    const onNamed = (e: Event) => log(e.type);
    for (const type of named) window.addEventListener(type, onNamed);
    const { pushState, replaceState } = history;
    history.pushState = (...args) => {
      log(`pushState ${String(args[2]).slice(0, 40)}`);
      return pushState.apply(history, args);
    };
    history.replaceState = (...args) => {
      log(`replaceState ${String(args[2]).slice(0, 40)}`);
      return replaceState.apply(history, args);
    };
    const watched = (n: Node) =>
      n instanceof Element &&
      (n.hasAttribute("data-staff-tabbar") || n.querySelector("[data-staff-tabbar]"));
    const observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "attributes")
          log(`aria-expanded=${(m.target as Element).getAttribute("aria-expanded")}`, m.target);
        for (const n of m.removedNodes) if (watched(n)) log("TAB BAR REMOVED");
        for (const n of m.addedNodes) if (watched(n)) log("TAB BAR ADDED");
      }
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    return () => {
      log("TRACE UNMOUNTED");
      for (const type of events) window.removeEventListener(type, on, true);
      for (const type of named) window.removeEventListener(type, onNamed);
      history.pushState = pushState;
      history.replaceState = replaceState;
      observer.disconnect();
    };
  }, []);
  return (
    <pre className="fixed inset-x-0 top-0 z-50 max-h-[45vh] overflow-y-auto bg-foreground/90 p-2 text-[10px] leading-tight text-background">
      {lines.join("\n")}
    </pre>
  );
}
