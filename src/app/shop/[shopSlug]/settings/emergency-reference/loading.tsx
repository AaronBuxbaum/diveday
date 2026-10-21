import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Compact contact rows and response settings at the page's own width. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          titleWidth="w-72 max-w-full"
          titleLines={{ base: 2, sm: 1 }}
          description={false}
        />
        <div className="space-y-6">
          <div className={sectionCardClass({ padding: "none", className: "h-56" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-40" })} />
        </div>
      </div>
    </main>
  );
}
