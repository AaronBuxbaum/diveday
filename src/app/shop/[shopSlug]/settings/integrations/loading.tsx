import { SectionTabs } from "@/components/SectionTabs";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

export default function IntegrationsSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader pending titleWidth="w-64" description={false} />
        <SectionTabs pending count={4} />
        <div className="space-y-10">
          <SectionCard as="div" pending padding="none" className="h-64" />
          <SectionCard as="div" pending padding="none" className="h-56" />
          <SectionCard as="div" pending padding="none" className="h-64" />
        </div>
      </Pending>
    </main>
  );
}
