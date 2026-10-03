import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Panel-shaped skeleton for the shop's own WhatsApp sender settings. */
export default function WhatsAppSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        {/* The description is three lines at 390px and two at 1280 (K-97). */}
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        {/* The card shell comes from the same place the page's cards do, and
            the gap is the page's own `space-y-10` — a skeleton that drifts
            from what replaces it is a layout jump on every navigation. */}
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-44" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-40" })} />
        </div>
      </div>
    </main>
  );
}
