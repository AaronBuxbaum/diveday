import type { Page, TestInfo } from "@playwright/test";

/** Temporary #4183 observer: no scrolling, focus, history writes or polling. */
export async function startScrollDiagnostic(page: Page) {
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
    const geometry = () => ({
      padding: getComputedStyle(document.documentElement).scrollPaddingTop,
      height: document.documentElement.scrollHeight,
      mains: Array.from(document.querySelectorAll("main"), rect),
      chrome: Array.from(document.querySelectorAll("[data-chrome-bar]"), rect),
      headings: Array.from(document.querySelectorAll("h1"), rect),
      roster: Array.from(document.querySelectorAll("#roster"), rect),
    });
    const record = (
      kind: string,
      detail: unknown = {},
      ref?: object | null,
      target?: object | null,
    ) => {
      if (events.length >= 4000) return;
      // Geometry only at router decisions/consumption and browser scroll events;
      // the router's own Fragment reads above are reused, never remeasured.
      try {
        events.push({
          t: performance.now(),
          kind,
          url: location.pathname + location.search + location.hash,
          y: scrollY,
          ref: id(ref),
          target: id(target),
          detail,
          ...(kind === "consume" ||
          kind === "fragment-decision" ||
          kind === "scroll" ||
          kind === "final"
            ? { geometry: geometry() }
            : {}),
        });
      } catch (error) {
        events.push({ kind: "observer-error", message: String(error) });
      }
    };
    Object.assign(globalThis, { __nav4183: record, __nav4183Events: events });
    for (const kind of [
      "scroll",
      "popstate",
      "hashchange",
      "pageshow",
      "focusin",
      "click",
      "submit",
    ]) {
      window.addEventListener(
        kind,
        (event) => {
          const target = event.target;
          record(kind, {
            tag: target instanceof Element ? target.tagName : null,
            id: target instanceof Element ? target.id : null,
            href: target instanceof Element ? target.closest("a")?.getAttribute("href") : null,
            historyRestoration: history.scrollRestoration,
          });
        },
        { capture: true, passive: true },
      );
    }
  });
}

export async function attachScrollDiagnostic(page: Page, info: TestInfo) {
  const evidence = await page.evaluate(() => {
    const probe = globalThis as typeof globalThis & {
      __nav4183?: (kind: string) => void;
      __nav4183Events?: unknown[];
    };
    probe.__nav4183?.("final");
    return { url: location.href, events: probe.__nav4183Events ?? [] };
  });
  await info.attach("navigation-scroll-4183", {
    body: Buffer.from(
      JSON.stringify({ status: info.status, repeat: info.repeatEachIndex, ...evidence }, null, 2),
    ),
    contentType: "application/json",
  });
  if (!evidence.events.some((event) => (event as { kind?: string }).kind === "handler")) {
    throw new Error(
      "Navigation diagnostic collected no Next handler events; inspect probe bundling before trusting this run.",
    );
  }
}
