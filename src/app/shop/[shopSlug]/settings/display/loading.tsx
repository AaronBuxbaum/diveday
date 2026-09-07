import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Panel-shaped skeleton for the lobby-display settings: the form, then the list. */
export default function LobbyDisplayLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-64" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-32" })} />
        </div>
      </div>
    </main>
  );
}
