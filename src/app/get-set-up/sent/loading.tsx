import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * Skeleton for the set-up thank-you page: `EntryDone`'s centered column — the
 * mark's circle, the title, two lines of body and the one demo link — under the
 * marketing header, so the page lands without a jump.
 */
export default function SetUpSentLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback hideCta compactMobile />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <div className="flex w-full animate-pulse flex-col items-center">
          <div className="size-14 rounded-full bg-surface-sunken" />
          <div className="mt-6 h-9 w-48 rounded bg-surface-sunken" />
          <div className="mt-3 h-6 w-full rounded bg-surface-sunken" />
          <div className="mt-1 h-6 w-2/3 rounded bg-surface-sunken" />
          <div className="mt-6 h-5 w-32 rounded bg-surface-sunken" />
        </div>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
