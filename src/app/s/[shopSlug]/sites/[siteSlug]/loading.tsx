import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for a public dive-site page (ADR
 * 20260804-instant-navigation): the header block, the cover band the shop's
 * photograph fills, a run of prose bars for the briefing, and the hairline
 * rows the departures land in.
 *
 * The width tracks the page's own `max-w-4xl` column — without a file of its
 * own the route would fall back to the *schedule* skeleton at `max-w-6xl`, so
 * a diver would watch day headers at the wrong width and then land on a
 * narrower page.
 */
export default function DiveSitePageLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Pending>
        <ShopPageHeader
          pending
          titleWidth="w-72 max-w-full"
          description
          descriptionWidth="w-96 max-w-full"
          // The site's description is two lines at 390px, one at 1280.
          descriptionLines={{ base: 2, sm: 1 }}
          meta={<Bone className="h-5 w-56 max-w-full" />}
          actions
        />
        <Bone shape="panel" className="aspect-[3/2] w-full sm:aspect-[5/2]" />
        <div className="mt-8 space-y-3">
          <Bone className="h-3 w-24" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-2/3" />
        </div>
        <Bone className="mt-8 h-3 w-40" />
        <div className="mt-2 flex flex-col">
          {[0, 1, 2].map((row) => (
            <div key={row} className={`py-4 ${ledgerRowBoxClass}`}>
              <Bone className="h-4 w-40" />
              <Bone className="mt-1.5 h-4 w-32" />
            </div>
          ))}
        </div>
      </Pending>
    </main>
  );
}
