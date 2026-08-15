import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Panel-shaped skeleton for the shop's own WhatsApp sender settings. */
export default function WhatsAppSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        {/* The card shell comes from the same place the page's cards do, and
            the gap is the page's own `space-y-10` — a skeleton that drifts
            from what replaces it is a layout jump on every navigation. */}
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-44" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-40" })} />
        </div>
      </div>
    </main>
  );
}
