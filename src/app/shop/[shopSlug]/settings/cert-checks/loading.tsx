import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + editor-card skeleton at the page's own width, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          titleWidth="w-72 max-w-full"
          titleLines={{ base: 2, sm: 1 }}
          description
          descriptionIsCaption
          descriptionWidth="w-full max-w-xl"
          descriptionLines={2}
        />
        <div className={sectionCardClass({ padding: "lg", className: "h-[40rem]" })} />
      </div>
    </main>
  );
}
