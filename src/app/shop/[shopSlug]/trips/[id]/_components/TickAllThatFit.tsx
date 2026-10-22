"use client";

import { buttonClass } from "@/components/ui/button";

/**
 * **"Tick everyone who fits"**: the bulk tick for the panel's boxes. It ticks a
 * row only when it is not below this trip's bar (`data-below-bar`), so a bulk
 * send never reaches a diver the departure would not take; a below-the-bar row
 * can still be ticked by hand, and the Offer button says so. Boxes in a closed
 * "Show more" are ticked too: they fit.
 */
export function TickAllThatFit({ formId, label }: { formId: string; label: string }) {
  function tick() {
    const boxes = document.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"][form="${formId}"]`,
    );
    for (const box of boxes) {
      if (box.dataset.belowBar || box.checked) continue;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  return (
    <button type="button" onClick={tick} className={buttonClass({ variant: "ghost", size: "sm" })}>
      {label}
    </button>
  );
}
