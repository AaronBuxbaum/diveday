import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

export default function SecurityLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        <div className={sectionCardClass({ padding: "md", className: "mt-8 h-48" })} />
        <div className={sectionCardClass({ padding: "md", className: "mt-6 h-64" })} />
      </div>
    </main>
  );
}
