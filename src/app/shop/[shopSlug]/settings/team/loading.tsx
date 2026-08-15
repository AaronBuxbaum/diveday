import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Roster-shaped skeleton for the staff-account list (design principle 1) —
 * accounts, pending invitations, and role gates all resolve per request.
 */
export default function TeamSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-40" descriptionWidth="w-full max-w-xl" />
        {/* The invite card, then the roster of person-cards — the order the
            page renders them in, at the page's own `space-y-10`. */}
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-56" })} />
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
