import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { GuideBodySkeleton } from "../_components/guide";
import { ALONGSIDE_SKELETON_LINES } from "../_components/guide-skeleton-lines";

/** The `/switching/alongside` boundary: bars only, nothing to tap (ADR 20260804-instant-navigation). */
export default function AlongsideSwitchLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <GuideBodySkeleton lines={ALONGSIDE_SKELETON_LINES} />
      <MarketingFooterFallback />
    </div>
  );
}
