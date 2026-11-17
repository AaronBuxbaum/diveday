/** Read-only screenshot-time state; never focus, scroll, or alter the document. */
import type { Page } from "@playwright/test";

export async function logArrivalFocus(page: Page, phase: string) {
  const state = await page.locator("#arrival-search").evaluate((input) => {
    const active = document.activeElement;
    const style = getComputedStyle(input);
    return {
      active: active
        ? { tag: active.tagName, id: active.id, role: active.getAttribute("role") }
        : null,
      hydrated: input.getAttribute("data-hydrated"),
      focus: input.matches(":focus"),
      focusVisible: input.matches(":focus-visible"),
      style: {
        outline: style.outline,
        outlineOffset: style.outlineOffset,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderStyle: style.borderStyle,
      },
      requestedCall: new URLSearchParams(location.search).has("call"),
      callPanels: document.querySelectorAll("#call-panel").length,
      addPanels: document.querySelectorAll("[data-add-panel-heading]").length,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  console.log("diveday-arrival-focus-diagnostic", JSON.stringify({ phase, ...state }));
}

export async function logSettingsRail(page: Page, phase: string) {
  const state = await page
    .getByRole("navigation", { name: "Settings sections" })
    .evaluate((rail) => {
      const rect = (box: DOMRect) => ({ x: box.x, y: box.y, width: box.width, height: box.height });
      const scroller = rail.querySelector<HTMLElement>("[data-settings-rail-scroller]");
      const selected = rail.querySelector('[aria-current="true"]');
      return {
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        scroller: scroller
          ? {
              scrollTop: scroller.scrollTop,
              scrollLeft: scroller.scrollLeft,
              clientWidth: scroller.clientWidth,
              clientHeight: scroller.clientHeight,
              scrollWidth: scroller.scrollWidth,
              scrollHeight: scroller.scrollHeight,
              rect: rect(scroller.getBoundingClientRect()),
              maxHeight: getComputedStyle(scroller).maxHeight,
              settled: scroller.hasAttribute("data-rail-settled"),
              moreBelow: scroller.hasAttribute("data-more-below"),
            }
          : null,
        selected: selected
          ? {
              rect: rect(selected.getBoundingClientRect()),
              visible: selected.getClientRects().length > 0,
            }
          : null,
      };
    });
  console.log("diveday-settings-rail-diagnostic", JSON.stringify({ phase, ...state }));
}

export async function logPackingCounts(page: Page) {
  const state = await page.evaluate(() => {
    const visible = (element: Element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const count = (selector: string) => {
      const elements = [...document.querySelectorAll(selector)];
      return { total: elements.length, visible: elements.filter(visible).length };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      selected: count('[data-settings-section="packing"]'),
      urgent: count("[data-settings-urgent]"),
      settings: count("[data-settings-section]"),
      selectedRailRows: count('[data-settings-rail-scroller] [aria-current="true"]'),
    };
  });
  console.log("diveday-packing-count-diagnostic", JSON.stringify(state));
}
