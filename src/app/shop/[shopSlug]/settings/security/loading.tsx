import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

export default function SecurityLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        <div className={sectionCardClass({ padding: "md", className: "mt-8 h-48" })} />
        <div className={sectionCardClass({ padding: "md", className: "mt-6 h-64" })} />
      </div>
    </main>
  );
}
