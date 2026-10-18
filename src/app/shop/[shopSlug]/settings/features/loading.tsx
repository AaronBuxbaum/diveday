import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Skeleton for the Features list: the title, then one card holding the rows. */
export default function FeaturesLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description={false} />
        <div className={sectionCardClass({ padding: "none", className: "h-96" })} />
      </div>
    </main>
  );
}
