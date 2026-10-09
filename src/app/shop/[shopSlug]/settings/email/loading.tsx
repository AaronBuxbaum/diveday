import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Two cards, shaped like the Monday email's and the after-hours ping's rows. */
export default function EmailSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
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
