import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { withRendererBound } from "./visual-harness";

/** Runs in the page: a loaded tile may still be transparent during Leaflet's fade. */
export async function mapIsReady(requireSelection = true) {
  const map = document.querySelector<HTMLElement>(".leaflet-container");
  const pane = map?.querySelector<HTMLElement>(".leaflet-map-pane");
  const marker = map?.querySelector<HTMLElement>(".leaflet-site-marker button.ring-4");
  const popup = map?.querySelector<HTMLElement>(".leaflet-popup");
  if (!map || !pane || (requireSelection && (!marker || !popup))) return false;
  if (popup?.querySelector('[aria-busy="true"]')) return false;
  const readyTiles = () => {
    const tiles = [...map.querySelectorAll<HTMLImageElement>(".leaflet-tile")];
    const visible = new Map<HTMLElement, boolean>();
    const paintsOpaque = (tile: HTMLElement) => {
      for (let node: HTMLElement | null = tile; node; node = node.parentElement) {
        const cached = visible.get(node);
        if (cached === false) return false;
        if (cached === true) break;
        const style = getComputedStyle(node);
        const paints =
          style.display !== "none" && style.visibility === "visible" && Number(style.opacity) === 1;
        visible.set(node, paints);
        if (!paints) return false;
      }
      return true;
    };
    return (
      tiles.length > 0 &&
      tiles.every(
        (tile) =>
          tile.classList.contains("leaflet-tile-loaded") &&
          tile.complete &&
          tile.naturalWidth > 0 &&
          paintsOpaque(tile),
      )
    );
  };
  if (
    !readyTiles() ||
    pane.classList.contains("leaflet-pan-anim") ||
    pane.classList.contains("leaflet-zoom-anim")
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
    return [pane.style.transform, marker && rect(marker), popup && rect(popup)];
  };
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await nextFrame();
  const before = geometry();
  await nextFrame();
  return (
    !pane.classList.contains("leaflet-pan-anim") &&
    !pane.classList.contains("leaflet-zoom-anim") &&
    readyTiles() &&
    JSON.stringify(before) === JSON.stringify(geometry())
  );
}

/** A bounded, URL-free snapshot, sampled only when the existing wait fails. */
export function mapPaintDiagnostics() {
  const map = document.querySelector<HTMLElement>(".leaflet-container");
  if (!map) return { map: "missing", tileCount: 0, tiles: [] };
  const describeNode = (node: HTMLElement) => {
    const style = getComputedStyle(node);
    const { x, y, width, height } = node.getBoundingClientRect();
    return {
      tag: node.tagName,
      className: String(node.className).slice(0, 120),
      opacity: style.opacity,
      display: style.display,
      visibility: style.visibility,
      transform: style.transform,
      rect: [x, y, width, height],
    };
  };
  const tiles = [...map.querySelectorAll<HTMLImageElement>(".leaflet-tile")];
  const count = Math.min(tiles.length, 8);
  return {
    tileCount: tiles.length,
    tiles: Array.from({ length: count }, (_, index) => {
      const tile = tiles[Math.floor((index * tiles.length) / count)];
      const ancestors = [];
      for (
        let node: HTMLElement | null = tile;
        node && ancestors.length < 12;
        node = node.parentElement
      ) {
        ancestors.push(describeNode(node));
      }
      const source = tile.currentSrc.match(
        /\/(World_Imagery|World_Boundaries_and_Places)\/MapServer\/tile\/(\d+\/\d+\/\d+)(?:\?|$)/,
      );
      return {
        source: source ? `${source[1]}/${source[2]}` : "other",
        loaded: tile.complete,
        width: tile.naturalWidth,
        ancestors,
      };
    }),
  };
}

async function waitForMapToSettle(page: Page, requireSelection: boolean) {
  // waitForFunction treats this async predicate's Promise as truthy even when
  // it resolves false. Poll the evaluated boolean in the driver instead.
  const rendererDeadline = Date.now() + 20_000;
  let sample: Promise<boolean> | undefined;
  try {
    await expect
      .poll(
        () => {
          sample = withRendererBound(
            page,
            "map pan, tile decode and fade",
            Math.max(1, rendererDeadline - Date.now()),
            page.evaluate(mapIsReady, requireSelection),
            false,
          );
          return sample;
        },
        { timeout: 15_000, message: "Map must settle before its screenshot" },
      )
      .toBe(true);
  } catch (error) {
    const remaining = rendererDeadline - Date.now();
    if (remaining > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const diagnostic = await Promise.race([
        page.evaluate(mapPaintDiagnostics).catch(() => null),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remaining);
        }),
      ]);
      clearTimeout(timer);
      if (diagnostic) console.error("Map paint diagnostics:", JSON.stringify(diagnostic));
    }
    throw error;
  } finally {
    // A matcher deadline must not abandon an in-flight renderer probe. All
    // samples share the original ceiling, so joining it cannot extend that bound.
    await sample;
  }
}

export async function waitForSelectedMapToSettle(page: Page) {
  await waitForMapToSettle(page, true);
}

/** Tooltip captures have no selected popup, but still need opaque, decoded tiles. */
export async function waitForMapTilesToSettle(page: Page) {
  await waitForMapToSettle(page, false);
}
