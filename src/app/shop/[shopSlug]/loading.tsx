import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * The staff subtree's page frame (design principle 1) — the shop home's own
 * skeleton, and the floor every `/shop/[shopSlug]` descendant falls back to.
 *
 * Deliberately generic, and that is the interesting part. A `loading.tsx`
 * covers its own segment *and* everything below it, so this is also what paints
 * while `trips/[id]/layout.tsx` or `waivers/layout.tsx` resolve their sub-nav —
 * those two stay async by decision (ADR 20260803-instant-opt-out-placement's
 * amendment) and sit above their own segment's skeleton. A home-shaped frame,
 * stat row and all, would therefore flash a glimpse of Today on the way to a
 * trip. An eyebrow, a title, and a stack of cards is the shape every staff
 * surface genuinely shares, so the transition reads as "this page is arriving"
 * rather than as a different page briefly appearing.
 *
 * Every staff route that can say something more specific already does — see the
 * `loading.tsx` beside each of them.
 */
export default function ShopSurfaceLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending titleWidth="w-56" description descriptionWidth="w-72 max-w-full" />
        {/* Three station-shaped panels (ADR 20260904-reef-all-the-way-down,
            slice 16a): the shell the spine paints into, so the skeleton and
            the page share one silhouette. */}
        <div className="mt-8 flex flex-col gap-5">
          {[0, 1, 2].map((i) => (
            <SectionCard key={i} as="div" pending padding="lg">
              <div className="flex items-start gap-5">
                <Bone shape="inset" className="h-15 w-21 shrink-0" />
                <div className="min-w-0 flex-1">
                  <Bone className="h-6 w-24" />
                  <Bone className="mt-2 h-5 w-64 max-w-full" />
                  <Bone className="mt-2 h-4 w-80 max-w-full" />
                </div>
                <Bone shape="pill" className="size-19 shrink-0" />
              </div>
              <div className="mt-5 flex flex-col">
                {[0, 1, 2].map((row) => (
                  <div key={row} className={`flex items-center gap-3 py-4 ${ledgerRowBoxClass}`}>
                    <Bone shape="pill" className="size-5" />
                    <Bone className="h-4 w-20" />
                    <Bone className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
