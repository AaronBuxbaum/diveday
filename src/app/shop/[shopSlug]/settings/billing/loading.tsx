import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + the one plan card, at the page's own width, so the route never blocks blank. */
export default function BillingSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-40" description={false} />
        <div className={sectionCardClass({ padding: "none", className: "h-56" })} />
      </div>
    </main>
  );
}
