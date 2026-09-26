import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

export default function SafetyChecklistLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        {/* "Pre-departure checklist" wraps to two lines at 390px and its
            description to three; one and two at 1280 (K-97). */}
        <ShopPageHeaderSkeleton
          titleWidth="w-56"
          titleLines={{ base: 2, sm: 1 }}
          description
          descriptionWidth="w-full max-w-md"
          descriptionLines={{ base: 3, sm: 2 }}
        />
        <div className={sectionCardClass({ padding: "none", className: "mt-6 h-72" })} />
      </div>
    </main>
  );
}
