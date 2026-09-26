import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

export default function IntegrationsSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-64" description descriptionWidth="w-full max-w-xl" />
        <div className="mt-10 space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-64" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-56" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-64" })} />
        </div>
      </div>
    </main>
  );
}
