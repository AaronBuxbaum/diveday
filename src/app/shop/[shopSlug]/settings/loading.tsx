import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Panel-shaped skeleton for shop settings (design principle 1). It is also the
 * fallback the settings sub-pages inherit when they have none of their own.
 */
export default function SettingsLoading() {
  return (
    // max-w-3xl to match SettingsPage — a wider skeleton made every navigation
    // into Settings jump sideways when the real page landed.
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" descriptionWidth="w-full max-w-xl" />
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
