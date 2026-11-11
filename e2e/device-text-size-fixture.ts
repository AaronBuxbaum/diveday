import type { Locator, Page } from "@playwright/test";

/**
 * Simulates only the device-body capability boundary, never the app's scaling.
 * Chromium and macOS WebKit emulation cannot set an iPhone's Dynamic Type.
 */
export async function exposeDeviceBody(page: Page, bodySize: number) {
  await page.addInitScript((size) => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (property: string, value?: string) =>
      property === "font" && value === "-apple-system-body"
        ? true
        : value === undefined
          ? supports(property)
          : supports(property, value);
    const computed = window.getComputedStyle.bind(window);
    window.getComputedStyle = (element, pseudo) => {
      const style = computed(element, pseudo);
      return element.hasAttribute("data-device-text-probe")
        ? new Proxy(style, {
            get: (target, key) => (key === "fontSize" ? `${size}px` : Reflect.get(target, key)),
          })
        : style;
    };
    const paints: string[] = [];
    Object.assign(window, { deviceTextPaints: paints });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint")
          paints.push(computed(document.documentElement).fontSize);
      }
    }).observe({ type: "paint", buffered: true });
  }, bodySize);
}

/** Complete short words must not become vertical columns at an enlarged size. */
export async function fragmentedWords(locator: Locator) {
  return locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const broken: Array<{ word: string; lines: number }> = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (text.parentElement?.closest(".sr-only, [aria-hidden=true]")) continue;
      for (const word of (text.textContent ?? "").matchAll(/[A-Za-z]+/g)) {
        // A genuinely long word may wrap on a phone. Ordinary words must fit.
        if (word[0].length > 8) continue;
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        const lines = range.getClientRects().length;
        if (lines > 1) broken.push({ word: word[0], lines });
      }
    }
    return broken;
  });
}
