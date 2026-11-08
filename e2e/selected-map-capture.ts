import type { Page } from "@playwright/test";
import { withRendererBound } from "./visual-harness";

/** Runs in the page: a loaded tile may still be transparent during Leaflet's fade. */
export async function selectedMapIsReady() {
  const map = document.querySelector<HTMLElement>(".leaflet-container");
  const pane = map?.querySelector<HTMLElement>(".leaflet-map-pane");
  const marker = map?.querySelector<HTMLElement>(".leaflet-site-marker button.ring-4");
  const popup = map?.querySelector<HTMLElement>(".leaflet-popup");
  if (!map || !pane || !marker || !popup) return false;
  const readyTiles = () => {
    const tiles = [...map.querySelectorAll<HTMLImageElement>(".leaflet-tile")];
    return (
      tiles.length > 0 &&
      tiles.every(
        (tile) =>
          tile.classList.contains("leaflet-tile-loaded") &&
          tile.complete &&
          tile.naturalWidth > 0 &&
          Number(getComputedStyle(tile).opacity) === 1,
      )
    );
  };
  if (
    !readyTiles() ||
    pane.classList.contains("leaflet-pan-anim") ||
    map.classList.contains("leaflet-zoom-anim")
  )
    return false;
  // Leaflet's loaded class precedes both image decoding and its Date-driven fade.
  try {
    await Promise.all(
      [...map.querySelectorAll<HTMLImageElement>(".leaflet-tile")].map((tile) => tile.decode()),
    );
  } catch {
    // Resizing can replace an image while decode is pending; poll the current tiles.
    return false;
  }
  const geometry = () => {
    const rect = (element: HTMLElement) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height];
    };
    return [pane.style.transform, rect(marker), rect(popup)];
  };
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await nextFrame();
  const before = geometry();
  await nextFrame();
  return (
    !pane.classList.contains("leaflet-pan-anim") &&
    !map.classList.contains("leaflet-zoom-anim") &&
    readyTiles() &&
    JSON.stringify(before) === JSON.stringify(geometry())
  );
}

export async function waitForSelectedMapToSettle(page: Page) {
  const settled = await withRendererBound(
    page,
    "selected map pan, tile decode and fade",
    20_000,
    page.waitForFunction(selectedMapIsReady, undefined, { timeout: 15_000 }).then(() => true),
    false,
  );
  if (!settled) throw new Error("Selected map did not settle before its screenshot");
}
