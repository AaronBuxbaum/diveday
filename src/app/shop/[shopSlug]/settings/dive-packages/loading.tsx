import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + editor-card skeleton at the page's own width, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-64" description descriptionWidth="w-full max-w-md" />
        <div className={sectionCardClass({ padding: "lg", className: "h-80" })} />
      </div>
    </main>
  );
}
