import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";
import { StaffSectionTabsSkeleton } from "../_components/StaffSectionTabs";

/**
 * Body-shaped skeleton for the Orders day ledger (design principle 1; the
 * shape it holds is ADR 20260827-clearwater-surface-language decision 7).
 *
 * It follows the page it replaces: a toolbar of a search box and two selects,
 * then day groups — a small-caps header line with its count and subtotal on
 * the right, and hairline rows beneath it directly on the page background. No
 * card shell anywhere, because the ledger has none; the skeleton this replaces
 * painted a filter card above a bordered table, which is a picture of a page
 * that no longer exists.
 */
export default function OrdersIndexLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-32" description={false} actions />
        <StaffSectionTabsSkeleton section="money" />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Bone shape="control" className="h-12 w-full sm:w-80" />
          <Bone shape="control" className="h-12 w-36" />
          <Bone shape="control" className="h-12 w-40" />
        </div>

        <div className="mt-8 flex flex-col gap-9">
          {[0, 1].map((group) => (
            <div key={group}>
              {/* The day's header is `GroupLabel`'s one `text-xs` line,
                  16px, and the rows start the list's `mt-2.5` under it: 26px,
                  where `h-3` bars in `pb-2` drew 20 (K-390). */}
              <div className="mb-2.5 flex h-4 items-center justify-between gap-3">
                <Bone className="h-3 w-32" />
                <Bone className="h-3 w-28" />
              </div>
              {/* `sm:h-13`: a `LedgerRow`'s 52px floor, which read 48 until
                  2026-09-02. Below `sm` the diver and what they bought stack
                  as two 24px lines, 2px apart, in the row's `py-2` under its
                  1px rule: 67px, `h-16.75` (K-390). */}
              {[0, 1, 2].map((row) => (
                <div key={row} className={`h-16.75 sm:h-13 ${ledgerRowBoxClass}`} />
              ))}
            </div>
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
