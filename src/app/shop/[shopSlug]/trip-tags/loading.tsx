import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { registerPaneClass } from "../_components/register-pane";

/** Readable rows followed by the closed add disclosure at the page's own width. */
export default function Loading() {
  return (
    <main className={registerPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        <div className={sectionCardClass({ padding: "none", className: "h-56" })} />
      </div>
    </main>
  );
}
