import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { StatusReportFallback } from "./_components/StatusReport";

/**
 * The `/status` segment's <Suspense> boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation).
 *
 * The same `StatusReportFallback` the page's own boundary uses, so the shape a
 * reader sees is identical whether they arrived by link or by typing the URL —
 * and so a change to the report's layout cannot leave the skeleton behind.
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
