import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

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
            <div className="my-1 h-4 min-w-0 flex-1 rounded bg-surface-sunken" />
            <div className="order-last my-0.5 h-4 min-w-0 basis-full rounded bg-surface-sunken" />
            <div className="h-4 w-14 shrink-0 rounded bg-surface-sunken" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WaiversLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          description={false}
          meta={<div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />}
        />
        {/* The release editor is a door at rest (`waivers/page.tsx`: "the
            ledger leads; the editor is a door"), one `md` secondary button.
            The open editor's card stood here, 426px of it, and the log landed
            378px above its own bars. */}
        <div className="h-12 w-40 rounded-lg bg-surface-sunken" />
        <div className="mt-10">
          <div className="h-4 w-36 rounded bg-surface-sunken" />
          <div className="mt-4 space-y-8">
            <div>
              <div className="h-4 w-28 rounded bg-surface-sunken" />
              <LogRows count={3} />
            </div>
            <div>
              <div className="h-4 w-28 rounded bg-surface-sunken" />
              <LogRows count={2} />
            </div>
          </div>
        </div>
      </div>
    </StaffPage>
  );
}
