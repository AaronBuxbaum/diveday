import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/** Content-shaped skeleton for the schedule board (design principle 1). */
export default function ScheduleBoardLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" descriptionWidth="w-56" />
      </div>
      <div className="mb-8 grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <div className="flex animate-pulse flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-surface" />
        ))}
      </div>
    </main>
  );
}
