import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

export default function IntegrationsSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-64" descriptionWidth="w-full max-w-xl" />
        <div className="mt-10 space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-64" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-56" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-64" })} />
        </div>
      </div>
    </main>
  );
}
