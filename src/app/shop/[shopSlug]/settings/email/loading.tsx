import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** One card, shaped like the Monday email's row. */
export default function EmailSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-32" description={false} />
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "md", className: "h-48" })} />
        </div>
      </div>
    </main>
  );
}
