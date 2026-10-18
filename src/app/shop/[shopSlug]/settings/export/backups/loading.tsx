import { SectionTabsSkeleton } from "@/components/SectionTabs";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../../_components/settings-pane";

/**
 * Header, the four tabs of Your data and the backups half (status card and
 * destination form), so the route never blocks blank.
 */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        <SectionTabsSkeleton count={4} />
        <div>
          <div className="h-5 w-28 rounded bg-surface-sunken" />
          <div className="mt-4 space-y-6">
            <div className={sectionCardClass({ padding: "lg" })}>
              <div className="h-5 w-44 rounded bg-surface-sunken" />
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {["a", "b", "c", "d"].map((slot) => (
                  <div key={slot} className="h-10 rounded-lg bg-surface-sunken" />
                ))}
              </div>
            </div>
            <div className={sectionCardClass({ padding: "lg" })}>
              <div className="h-5 w-52 rounded bg-surface-sunken" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {["a", "b", "c", "d", "e", "f"].map((slot) => (
                  <div key={slot} className="h-11 rounded-lg bg-surface-sunken" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
