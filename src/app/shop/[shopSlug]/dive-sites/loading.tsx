import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Tracks the library's current toolbar, map, and ledger structure to limit
 * the transition jump (design principle 1; ADR 20260827-the-shops-shelves).
 * Bars match their loaded boxes (docs/design/pixel-craft.md, class 11; K-415).
 * The `?view=catalog` view has another shape, which this route shell cannot
 * draw because it does not receive search params.
 */
export default function DiveSitesLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-56" description={false} actions />
        {/* The search box, in the `mb-6` toolbar the page draws it in. */}
        <Bone shape="control" className="mb-6 h-12 w-full sm:w-80" />
        <div className="mt-6 flex flex-col gap-8">
          {/* The map skeleton on the top */}
          <div className="w-full">
            <Bone shape="media" className="h-[440px] w-full sm:h-[540px] lg:h-[620px]" />
          </div>

          {/* The ledger skeleton underneath the map */}
          <div className="w-full min-w-0">
            {/* The catalog door: above the site rows */}
            <div className="mb-8">
              <div className={`flex min-h-13 items-center gap-3 ${ledgerRowBoxClass}`}>
                <Bone as="span" className="block size-5 shrink-0" />
                <SiteLineBars nameWidth="w-52" metaWidth="w-32" />
              </div>
            </div>
            <div className="space-y-8">
              {[3, 2].map((rows, group) => (
                <div key={rows}>
                  {/* The group label, at `GroupLabel`'s own height. */}
                  <Bone className="h-4 w-28" />
                  <div className="mt-2">
                    {Array.from({ length: rows }, (_unused, row) => (
                      <div
                        // Bars, not records: this list has a fixed length, never
                        // reorders, and holds no state — the position is the only
                        // identity a placeholder row has.
                        // biome-ignore lint/suspicious/noArrayIndexKey: see above
                        key={`${group}-${row}`}
                        className={`flex min-h-13 items-center justify-between gap-4 ${ledgerRowBoxClass}`}
                      >
                        <SiteLineBars nameWidth="w-40" metaWidth="w-56" />
                        <Bone as="span" className="block h-5 w-20 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Pending>
    </StaffPage>
  );
}

/** A row's two lines: the `font-medium` name's 24px line, then the `mt-0.5` meta's 20px. */
function SiteLineBars({ nameWidth, metaWidth }: { nameWidth: string; metaWidth: string }) {
  return (
    <span className="block w-full max-w-64 py-2">
      <Bone as="span" className={`block h-6 ${nameWidth} max-w-full`} />
      <Bone as="span" className={`mt-0.5 block h-5 ${metaWidth} max-w-full`} />
    </span>
  );
}
