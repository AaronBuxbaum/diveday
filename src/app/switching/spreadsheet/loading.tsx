import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { GuideBodySkeleton } from "../_components/guide";
import { SPREADSHEET_SKELETON_LINES } from "../_components/guide-skeleton-lines";

/**
 * The `/switching/spreadsheet` segment's `<Suspense>` boundary, and what a
 * client navigation into it paints (ADR 20260804-instant-navigation). Same
 * arrangement, and the same reason, as `src/app/product/loading.tsx`: the
 * page's `requestLocale()` read sits above everything it renders, so the chrome
 * is here too — `MarketingNavFallback` and `MarketingFooterFallback`, the
 * signed-out default-locale header and footer that almost every visitor to this
 * page gets anyway.
 *
 * The body is bars, and that is the point of this file rather than an economy:
 * the page it replaces used to paint a **whole second copy of itself in
 * English** as its fallback, and a reader who reached the CSV template button
 * or the importer door before the localized body resolved had the interaction
 * thrown away (FU-20260812-marketing-suspense-swap-discards-interaction). A
 * skeleton has nothing to tap, so there is nothing to lose. Anything
 * interactive added to this file reopens that bug.
 *
 * The bars are `GuideBodySkeleton`, the one the competitor guides paint too:
 * the guide hero and the "you are here" band with its wedge list, in their own
 * boxes and a bar per line this guide's words wrap to, so the streamed page
 * lands where the bars stood. Its own bars had two headline lines at every
 * width, a two-line lede for four on a phone, 44px doors and one-line facts,
 * and the band under the hero landed 264px low at 390 (K-410).
 */
export default function SpreadsheetSwitchLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <GuideBodySkeleton lines={SPREADSHEET_SKELETON_LINES} />
      <MarketingFooterFallback />
    </div>
  );
}
