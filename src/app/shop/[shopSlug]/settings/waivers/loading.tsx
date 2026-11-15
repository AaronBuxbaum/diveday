import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + release-editor card skeleton at the page's own width. */
export default function WaiversSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader pending titleWidth="w-64 max-w-full" titleLines={1} description={false} />
        <SectionCard as="div" pending padding="lg" className="h-[36rem]" />
      </Pending>
    </main>
  );
}
