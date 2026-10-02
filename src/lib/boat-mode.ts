/**
 * **Boat mode, switched on by hand** (ADR 20261001-logbook, decision 6). The
 * roll call always wears the Night Dive palette; anyone can put the rest of
 * the app in it too, from the staff identity menu. It is a choice about this
 * device, so it lives in the browser rather than on the person, and it is
 * the whole replacement for the ambient-light switch and the glare skin:
 * there is no sensor and no automatic mode.
 */
export const BOAT_MODE_STORAGE_KEY = "diveday:boat-mode";

/** The class that carries the palette, on `<html>` when the switch is on. */
export const BOAT_MODE_CLASS = "boat-mode";

/**
 * Applies a stored "on" before first paint, so a page in Boat mode never
 * flashes the paper palette on load. Static, with no user input in it.
 */
export function boatModeScript(): string {
  const key = JSON.stringify(BOAT_MODE_STORAGE_KEY);
  const cls = JSON.stringify(BOAT_MODE_CLASS);
  return `(function(){try{if(localStorage.getItem(${key})==="on")document.documentElement.classList.add(${cls})}catch(e){}})()`;
}

/** Turns Boat mode on or off for this device, now and on later loads. */
export function setBoatMode(on: boolean): void {
  document.documentElement.classList.toggle(BOAT_MODE_CLASS, on);
  try {
    if (on) localStorage.setItem(BOAT_MODE_STORAGE_KEY, "on");
    else localStorage.removeItem(BOAT_MODE_STORAGE_KEY);
  } catch {
    // Storage refused (a private window): the switch still holds for this page.
  }
}

/** Whether Boat mode is on for the page as it stands. */
export function isBoatModeOn(): boolean {
  return document.documentElement.classList.contains(BOAT_MODE_CLASS);
}
