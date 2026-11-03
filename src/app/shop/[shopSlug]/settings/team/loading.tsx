import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/**
 * Roster-shaped skeleton for the staff-account list (design principle 1) —
 * accounts, pending invitations, and role gates all resolve per request.
 */
export default function TeamSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeader pending titleWidth="w-40" description={false} />
        {/* The invite card, then the roster of person-cards — the order the
            page renders them in, at the page's own `space-y-10`. */}
        <div className="space-y-10">
          <SectionCard as="div" pending padding="none" className="h-56" />
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <SectionCard key={i} as="div" pending padding="none" className="h-28" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
