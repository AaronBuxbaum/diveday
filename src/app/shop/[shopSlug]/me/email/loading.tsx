import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { staffPageClass } from "../../_components/staff-page";

/** Two cards, shaped like the Monday email's and the after-hours ping's rows. */
export default function EmailSettingsLoading() {
  return (
    <main className={staffPageClass("reading")}>
      <div className="animate-pulse">
        <ShopPageHeader pending titleWidth="w-32" description={false} />
        <div className="space-y-10">
          <SectionCard as="div" pending padding="md" className="h-48" />
          <SectionCard as="div" pending padding="md" className="h-40" />
        </div>
      </div>
    </main>
  );
}
