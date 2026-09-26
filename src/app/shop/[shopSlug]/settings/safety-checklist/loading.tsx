import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

export default function SafetyChecklistLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
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
