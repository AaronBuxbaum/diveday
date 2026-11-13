import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { StaffSectionTabsSkeleton } from "@/app/shop/[shopSlug]/_components/StaffSectionTabs";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for the waiver surface (design principle 1): the
 * version line under the title, the closed "Edit the release" door, then the
 * signature log as hairline day groups beneath it — the shape ADR
 * 20260827-people-not-lists gave this page when the Signatures tab folded into
 * it. It owns the `<main>` shell now, the sub-nav layout that used to render
 * one having gone with the tabs.
 */
function LogRows({ count }: { count: number }) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          className={ledgerRowBoxClass}
        >
          {/* A signature row as `SignatureLog` draws it: the rule on the
              row's box, and in it the summary's grammar — a 51px floor,
              wrapping, the name's 24px line and the departure's 20px one. The
              departure takes a full-width line at every width, as the loaded
              departure does; a fixed one-line row would shift the log when
              its records arrive. */}
          <div className="flex min-h-12.75 flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Bone className="my-1 h-4 min-w-0 flex-1" />
            <Bone className="order-last my-0.5 h-4 min-w-0 basis-full" />
            <Bone className="h-4 w-14 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WaiversLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader
          pending
          description={false}
          meta={<Bone className="h-5 w-56 max-w-full" />}
        />
        <StaffSectionTabsSkeleton section="safety" />
        {/* The release editor is a door at rest (`waivers/page.tsx`: "the
            ledger leads; the editor is a door"), one `md` secondary button.
            The open editor's card stood here, 426px of it, and the log landed
            378px above its own bars. */}
        <Bone shape="control" className="h-12 w-40" />
        <div className="mt-10">
          <Bone className="h-4 w-36" />
          <div className="mt-4 space-y-8">
            <div>
              <Bone className="h-4 w-28" />
              <LogRows count={3} />
            </div>
            <div>
              <Bone className="h-4 w-28" />
              <LogRows count={2} />
            </div>
          </div>
        </div>
      </Pending>
    </StaffPage>
  );
}
