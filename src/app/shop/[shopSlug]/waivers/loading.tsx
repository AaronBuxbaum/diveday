import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the waiver surface (design principle 1): the
 * version line under the title, the release editor in its card, then the
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
          className="flex h-12 items-center gap-3 border-t border-border last:border-b"
        >
          <div className="h-4 w-40 shrink-0 rounded bg-surface-sunken" />
          <div className="h-4 flex-1 rounded bg-surface-sunken" />
          <div className="h-4 w-14 shrink-0 rounded bg-surface-sunken" />
        </div>
      ))}
    </div>
  );
}

export default function WaiversLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          description={false}
          meta={<div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />}
        />
        <div className={sectionCardClass({ padding: "lg" })}>
          <div className="h-4 w-28 rounded bg-surface-sunken" />
          <div className="mt-2 h-72 rounded bg-surface-sunken" />
          <div className="mt-5 h-11 w-32 rounded-lg bg-surface-sunken" />
        </div>
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
    </main>
  );
}
