import { ShopPageHeader, SkeletonLineBars } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Archive-shaped skeleton (ADR 20260804-instant-navigation), sized to the
 * page's max-w-4xl column and the hairline ledger rows (ADR
 * 20260827-clearwater-surface-language, decision 2). Match each placeholder
 * to the line box it replaces (pixel-craft class 11, K-383): the 24px
 * aggregate, five 20px histogram rows, and each review's 24px rating line,
 * 24px quote (up to two phone lines), and 20px byline.
 */
export default function PublicReviewsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Pending>
        <ShopPageHeader pending titleWidth="w-48" description={false} />

        {/* Aggregate line. */}
        <div className="flex h-6 items-center gap-2">
          <Bone className="h-4 w-24" />
          <Bone className="h-4 w-28" />
        </div>

        {/* Five rating rows. */}
        <div data-histogram className="mt-4 flex max-w-sm flex-col gap-1.5">
          {[5, 4, 3, 2, 1].map((rating) => (
            <div key={rating} className="flex h-5 items-center">
              <Bone className="h-1.5 w-full" />
            </div>
          ))}
        </div>

        {/* Hairline rows matching `ReviewLedger`. */}
        <div className="mt-4 flex flex-col">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className={`py-4 ${ledgerRowBoxClass}`}>
              <div className="flex h-6 items-center">
                <Bone className="h-4 w-24" />
              </div>
              <div className="mt-1.5">
                <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-6" width="w-96 max-w-full" />
              </div>
              <Bone className="mt-1.5 h-5 w-48 max-w-full" />
            </div>
          ))}
        </div>
      </Pending>
    </main>
  );
}
