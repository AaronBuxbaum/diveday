import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Roster-shaped skeleton for the staff-account list (design principle 1) —
 * accounts, pending invitations, and role gates all resolve per request.
 */
export default function TeamSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-40" descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface" />
          ))}
        </div>
        <div className="mt-8 h-56 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
