import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Panel-shaped skeleton for the embeddable-schedule settings. */
export default function EmbedSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-full max-w-xl" />
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
