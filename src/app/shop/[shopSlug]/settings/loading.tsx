import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "./_components/settings-pane";

/**
 * Panel-shaped skeleton for shop settings (design principle 1). It is also the
 * fallback the settings sub-pages inherit when they have none of their own.
 */
export default function SettingsLoading() {
  return (
    // The pane SettingsPage takes — a wider skeleton made every navigation
    // into Settings jump sideways when the real page landed.
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" description={false} />
        {/* Three labelled groups, each a row list wearing the card shell — the
            shape and the `space-y-10` both come from where the page takes
            them, so the skeleton cannot drift into a layout jump. */}
        <div className="mt-8 space-y-10">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="mb-3 h-4 w-28 rounded bg-surface-sunken" />
              <div className={sectionCardClass({ padding: "none", className: "h-56" })} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
