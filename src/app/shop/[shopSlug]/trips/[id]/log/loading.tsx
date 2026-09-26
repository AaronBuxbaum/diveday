import { SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * How many lines each summary tile's label takes. A row of tiles shares one
 * label row (`ShopStat` subgrids onto the grid), as tall as its longest label:
 * "Divers on the / manifest" and "Recorded not / boarded" are two lines at
 * every width, so every row that holds one is; at 390 the fifth tile, "Crew
 * assigned", has a row of its own and takes one.
 */
const TILE_LABEL_LINES: readonly SkeletonLines[] = [2, 2, 2, 2, { base: 1, sm: 2 }];

/**
 * Document-shaped skeleton for the incident-ready export (design principle 1).
 * Like its sibling `manifest/loading.tsx` this renders as the trip layout's
 * children, so only the document body swaps in — the header block, the summary
 * tiles, and the roster table frame appear immediately while the full evidence
 * assembly runs.
 *
 * **The page's own anatomy, line for line** (pixel-craft class 11). It drew a
 * 113px header against the loaded 256, no "Departure summary" heading and
 * 80px tiles against 125, so the tile row landed 184px below where it was
 * drawn at 1280. The numbers are read off `log/page.tsx` and move with it:
 *
 *   - the eyebrow's `h-4` wrapper (`EYEBROW_TAP_WRAPPER`), then the title's
 *     36px lines (`SHELL_TITLE_CLASS`, `text-3xl`) and the date line's 24px,
 *     each `mt-1`; two lines of each at 390, one from `sm`;
 *   - the Print button beside them (`md`, 48px) on a desk, under them `gap-4`
 *     on a phone, where the title's width sends it (`flex-wrap`);
 *   - the three `text-sm` paragraphs (20px lines), `mt-3`, `mt-2`, `mt-2`:
 *     3, 2 and 1 lines from `sm`, 4, 3 and 2 at 390;
 *   - `pb-6` and the rule; then `space-y-10`, the summary's `h-7` heading,
 *     and tiles of `ShopStat`'s own card: its padding, the label lines, the
 *     `gap-y-2` and the 36px figure.
 */
export default function IncidentExportLoading() {
  return (
    <div className="animate-pulse space-y-10">
      <div className="border-b border-border pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="h-4 w-16 rounded bg-surface-sunken" />
            <div className="mt-1">
              <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-9" width="w-120 max-w-full" />
            </div>
            <div className="mt-1">
              <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-6" width="w-100 max-w-full" />
            </div>
          </div>
          <div className="h-12 w-36 rounded-lg bg-surface-sunken" />
        </div>
        <div className="mt-3">
          <SkeletonLineBars lines={{ base: 4, sm: 3 }} height="h-5" width="w-140 max-w-full" />
        </div>
        <div className="mt-2">
          <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-5" width="w-144 max-w-full" />
        </div>
        <div className="mt-2">
          <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-156 max-w-full" />
        </div>
      </div>
      <div>
        <div className="h-7 w-48 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TILE_LABEL_LINES.map((lines, tile) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the tile's place is the only identity a placeholder has
            <div key={tile} className={sectionCardClass()}>
              <SkeletonLineBars lines={lines} height="h-5" width="w-24 max-w-full" />
              <div className="mt-2 h-9 w-10 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
      <div className={sectionCardClass({ padding: "none", className: "h-64 w-full" })} />
    </div>
  );
}
