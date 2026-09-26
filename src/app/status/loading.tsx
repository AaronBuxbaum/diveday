import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { StatusReportFallback } from "./_components/StatusReport";

/**
 * The `/status` segment's <Suspense> boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation).
 *
 * The same `StatusReportFallback` the page's own boundary uses, so the shape a
 * reader sees is identical whether they arrived by link or by typing the URL.
 * Living beside the report was not enough to keep that shape the report's: its
 * bars were 16px for 20px lines and its card 8px high (K-403). It now draws the
 * report's card, list and rows from the classes the two share, so a change to
 * the list moves the skeleton with it; how far the words wrap is still
 * written down in the fallback.
 */
export default function StatusLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <StatusReportFallback />
      <MarketingFooterFallback />
    </div>
  );
}
