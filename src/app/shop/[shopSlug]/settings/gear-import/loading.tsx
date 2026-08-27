import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Header + upload-card skeleton, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-full max-w-xl" />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="h-5 w-44 rounded bg-surface-sunken" />
          <div className="mt-4 h-9 w-56 rounded-lg bg-surface-sunken" />
          <div className="mt-5 h-11 w-full max-w-sm rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
