import type { CardinalDirection } from "@/lib/marine-forecast";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **The eight-point compass, in the reader's own letters** (issue #1270).
 *
 * `src/lib/marine-forecast.ts` returns the bearing as a code — `"w"`, `"sw"` —
 * and says why in its own header: `"N"`/`"NE"` read as neutral symbols and are
 * not. Spanish writes **O** for west, and **SO** and **NO** for the two corners
 * that touch it, so a hard-coded `"W"` on a Spanish page is a wrong word, not a
 * shorter one. The codes, the bundle keys and that rationale all landed; only
 * this lookup between them was never written, and both surfaces rendering a
 * bearing called `.toUpperCase()` on the code instead.
 *
 * ### Why the staff bundle, and why the diver keys went
 *
 * The eight keys sat in `diver.json` under `common.compass.*` with no reader at
 * all, while every surface that shows a bearing — a departure's conditions
 * block and the schedule board's wind line — is staff. `unit-labels.ts` is
 * deliberately diver-only and says so at the top: *one code, two bundles, never
 * shared strings*, with `shared.depth.*` as the standing precedent for the
 * staff half of exactly this shape.
 *
 * So the labels are staff copy, beside those, and the diver keys were deleted
 * rather than moved: nothing diver-facing renders a bearing, and the diver's
 * own conditions line deliberately shows a *band* ("light chop") rather than
 * numbers and headings — a captain reads the compass, a diver reads the sea.
 * A diver surface that ever wants one adds the key back with its reader.
 */
const COMPASS_KEYS: Record<CardinalDirection, StaffMessageKey> = {
  n: "shared.compass.n",
  ne: "shared.compass.ne",
  e: "shared.compass.e",
  se: "shared.compass.se",
  s: "shared.compass.s",
  sw: "shared.compass.sw",
  w: "shared.compass.w",
  nw: "shared.compass.nw",
};

/**
 * A bearing code as the letters this reader's compass uses.
 *
 * Takes `null`/`undefined` and answers `""`, because every call site is
 * interpolating into an ICU template whose sentence still reads without a
 * bearing — the forecast supplies wave, wind and current directions
 * independently, and any one of them can be absent.
 */
export function compassText(
  t: StaffTranslator,
  code: CardinalDirection | null | undefined,
): string {
  return code ? t(COMPASS_KEYS[code]) : "";
}
