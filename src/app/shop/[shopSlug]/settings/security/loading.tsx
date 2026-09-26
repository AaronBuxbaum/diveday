import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

export default function SecurityLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        {/* The page's own rhythm: one `space-y-10` between its sections, and
            the header's `mb-8` above them (K-521). */}
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "md", className: "h-48" })} />
          <div className={sectionCardClass({ padding: "md", className: "h-64" })} />
        </div>
      </div>
    </main>
  );
}
