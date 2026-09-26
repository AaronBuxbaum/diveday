import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Header + editor-card skeleton at the page's own width, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-64" description descriptionWidth="w-full max-w-md" />
        <div className={sectionCardClass({ padding: "lg", className: "h-80" })} />
      </div>
    </main>
  );
}
