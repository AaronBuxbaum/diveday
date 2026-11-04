import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + editor-card skeleton at the page's own width, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader
          pending
          titleWidth="w-80 max-w-full"
          titleLines={{ base: 2, sm: 1 }}
          description
          descriptionIsCaption
          descriptionWidth="w-full max-w-xl"
          descriptionLines={1}
        />
        <SectionCard as="div" pending padding="lg" className="h-[72rem]" />
      </Pending>
    </main>
  );
}
