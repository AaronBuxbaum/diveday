import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { staffPageClass } from "../../_components/staff-page";

/** Two cards, shaped like the Monday email's and the after-hours ping's rows. */
export default function EmailSettingsLoading() {
  return (
    <main className={staffPageClass("reading")}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-32" description={false} />
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "md", className: "h-48" })} />
          <div className={sectionCardClass({ padding: "md", className: "h-40" })} />
        </div>
      </div>
    </main>
  );
}
