import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Skeleton for the set-up thank-you page: `EntryDone`'s centered column — the
 * mark's circle, the title, two lines of body and the one demo link — under the
 * marketing header, so the page lands without a jump.
 */
export default function SetUpSentLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback compactMobile />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Pending className="flex w-full flex-col items-center">
          <Bone shape="pill" className="size-14" />
          <Bone className="mt-6 h-9 w-48" />
          <Bone className="mt-3 h-6 w-full" />
          <Bone className="mt-1 h-6 w-2/3" />
          <Bone className="mt-6 h-5 w-32" />
        </Pending>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
