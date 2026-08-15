import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Detail-shaped skeleton for one dive site (design principle 1) — briefing,
 * media, and landmark blocks all resolve per request.
 */
export default function DiveSiteLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-72 max-w-full" descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 h-56 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
