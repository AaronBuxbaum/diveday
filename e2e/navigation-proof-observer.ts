import { writeFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";

// Read-only #4183 evidence, installed only into the ephemeral expected-red run.
export async function startNavigationProof(page: Page) {
  await page.addInitScript(() => {
    const events: unknown[] = [];
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const id = (value?: object | null) => {
      if (!value) return null;
      if (!ids.has(value)) ids.set(value, ++nextId);
      return ids.get(value);
    };
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    };
    const record = (kind: string, detail = {}, ref?: object | null, target?: object | null) => {
      if (events.length >= 4000) return;
      events.push({
        t: performance.now(),
        kind,
        url: location.pathname,
        y: scrollY,
        ref: id(ref),
        target: id(target),
        detail,
        geometry: {
          padding: getComputedStyle(document.documentElement).scrollPaddingTop,
          height: document.documentElement.scrollHeight,
          viewport: document.documentElement.clientHeight,
          mains: Array.from(document.querySelectorAll("main"), rect),
          chrome: Array.from(document.querySelectorAll("[data-chrome-bar]"), rect),
          headings: Array.from(document.querySelectorAll("h1"), rect),
        },
      });
    };
    Object.assign(globalThis, { __nav4183: record, __nav4183Events: events });
    window.addEventListener(
      "click",
      (event) => {
        const href =
          event.target instanceof Element ? event.target.closest("a")?.getAttribute("href") : null;
        if (href) record("click", { destination: new URL(href, location.href).pathname });
      },
      { capture: true, passive: true },
    );
    window.addEventListener("scroll", () => record("scroll"), { capture: true, passive: true });
  });
}

export async function attachNavigationProof(page: Page, info: TestInfo) {
  const evidence = await page.evaluate(() => {
    const probe = globalThis as typeof globalThis & {
      __nav4183?: (kind: string) => void;
      __nav4183Events?: unknown[];
    };
    probe.__nav4183?.("final");
    return { events: probe.__nav4183Events ?? [] };
  });
  const file = info.outputPath("navigation-scroll-4183.json");
  writeFileSync(file, JSON.stringify({ repeat: info.repeatEachIndex, ...evidence }, null, 2));
  await info.attach("navigation-scroll-4183", { path: file, contentType: "application/json" });
}
