import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { staffPageClass } from "../../_components/staff-page";

/** Panel-shaped skeleton for the staff calendar-feed settings. */
export default function CalendarSettingsLoading() {
  return (
    <main className={staffPageClass("reading")}>
      <Pending>
        <ShopPageHeader pending titleWidth="w-56" description={false} />
        {/* Two feed panels are a list of like cards, not a run of sections, so
            they keep the page's own `gap-4` rather than the section rhythm. */}
        <div className="mt-8 grid gap-4">
          <SectionCard as="div" pending padding="none" className="h-48" />
          <SectionCard as="div" pending padding="none" className="h-32" />
        </div>
      </Pending>
    </main>
  );
}
