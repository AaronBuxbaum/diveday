import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/** Readable rows followed by the closed add disclosure at the page's own width. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-64" description={false} />
        <div className="space-y-10">
          <div>
            {[0, 1, 2].map((row) => (
              <div key={row} className={`${ledgerRowBoxClass} flex min-h-13 items-center py-2`}>
                <div className="h-4 w-2/3 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
          <div className={sectionCardClass({ padding: "none", className: "h-14" })} />
        </div>
      </div>
    </main>
  );
}
