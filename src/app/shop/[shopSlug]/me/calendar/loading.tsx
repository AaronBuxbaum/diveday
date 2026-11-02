import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { staffPageClass } from "../../_components/staff-page";

/** Panel-shaped skeleton for the staff calendar-feed settings. */
export default function CalendarSettingsLoading() {
  return (
    <main className={staffPageClass("reading")}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        {/* Two feed panels are a list of like cards, not a run of sections, so
            they keep the page's own `gap-4` rather than the section rhythm. */}
        <div className="mt-8 grid gap-4">
          <div className={sectionCardClass({ padding: "none", className: "h-48" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-32" })} />
        </div>
      </div>
    </main>
  );
}
