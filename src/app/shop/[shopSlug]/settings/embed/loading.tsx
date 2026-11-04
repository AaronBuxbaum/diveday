import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/** Panel-shaped skeleton for the embeddable-schedule settings. */
export default function EmbedSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader
          pending
          description
          descriptionIsCaption
          descriptionWidth="w-full max-w-xl"
        />
        {/* Shell and gap from the same places the page takes them, so the
            skeleton cannot drift into a layout jump. */}
        <div className="space-y-10">
          <SectionCard as="div" pending padding="none" className="h-40" />
          <SectionCard as="div" pending padding="none" className="h-64" />
        </div>
      </Pending>
    </main>
  );
}
