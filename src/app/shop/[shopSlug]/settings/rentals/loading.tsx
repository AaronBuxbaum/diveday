import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + editor-card skeleton at the page's own width, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeader
          pending
          titleWidth="w-48"
          titleLines={1}
          description
          descriptionIsCaption
          descriptionWidth="w-full max-w-xl"
          descriptionLines={1}
        />
        <SectionCard as="div" pending padding="lg" className="h-96" />
      </div>
    </main>
  );
}
