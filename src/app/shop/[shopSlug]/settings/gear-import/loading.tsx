import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + upload-card skeleton, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description={false} />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="h-5 w-44 rounded bg-surface-sunken" />
          <div className="mt-4 h-9 w-56 rounded-lg bg-surface-sunken" />
          <div className="mt-5 h-11 w-full max-w-sm rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
