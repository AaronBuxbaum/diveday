import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Departure-picker skeleton for the global "add a booking" door (design
 * principle 1) — step one is choosing which departure to seat someone on, and
 * that list is read per request.
 */
export default function NewBookingLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-lg" />
        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
