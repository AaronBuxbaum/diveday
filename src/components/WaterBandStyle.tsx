import type { WaterBand } from "@/lib/water-band";

/**
 * **The hour's wash, as a property rather than an attribute** (issue #1446).
 *
 * The staff shell paints Reef's water band on `#shop-main-content` — the
 * element that wraps `{children}` — and which of the four washes it wears is
 * the *shop's* clock (ADR 20260904-reef-all-the-way-down, decision 2). That
 * used to be a `data-water-band` attribute on the wrapper, which meant a shop
 * read sitting above the page: exactly the await the App Shell restructure
 * exists to remove, and one that cost every staff route its static shell.
 *
 * A `<style>` needs no wrapper. It applies wherever it lands, so it can stream
 * in beside the page rather than block it — the same answer `BrandStyle` gives
 * for the shop's brand on the diver-facing shell. `globals.css` ships the day
 * wash on the base `.water-band` class and this only re-points `--water-crest`
 * for the other three hours, so it sets exactly what the attribute set and the
 * pixels are identical. An id selector outranks the class, and a body `<style>`
 * comes after the sheet, so it wins twice over.
 *
 * The band is repeated as an attribute on the `<style>` itself, and that is not
 * decoration: `e2e/visual.spec.ts` waits on it to know a capture is of the page
 * rendered as *this* shop rather than of the shell, which is what the attribute
 * on the wrapper used to tell it. Being a `<style>`, it is attached and never
 * visible, so those waits ask for `attached`.
 *
 * `band` comes from `waterBandFor`, whose return type is the closed
 * {@link WaterBand} union, so the interpolation can only ever name a token the
 * palette carries — `water-band-palette.test.ts` pins that both ways.
 */
export function WaterBandStyle({ band }: { band: WaterBand }) {
  return (
    <style data-water-band={band}>{`#shop-main-content{--water-crest:var(--water-${band})}`}</style>
  );
}
