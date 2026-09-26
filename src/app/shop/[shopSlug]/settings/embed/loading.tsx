import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Panel-shaped skeleton for the embeddable-schedule settings. */
export default function EmbedSettingsLoading() {
  return (
    <main className={settingsPaneClass("5xl")}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description descriptionWidth="w-full max-w-xl" />
        {/* Shell and gap from the same places the page takes them, so the
            skeleton cannot drift into a layout jump. */}
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-40" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-64" })} />
        </div>
      </div>
    </main>
  );
}
