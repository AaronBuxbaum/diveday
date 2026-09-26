import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Panel-shaped skeleton for the lobby-display settings: the form, then the list. */
export default function LobbyDisplayLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" description descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-64" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-32" })} />
        </div>
      </div>
    </main>
  );
}
