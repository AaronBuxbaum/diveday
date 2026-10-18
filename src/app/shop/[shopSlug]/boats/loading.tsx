import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { registerPaneClass } from "../_components/register-pane";

/** Header + editor-card skeleton at the page's own width, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={registerPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        <div className={sectionCardClass({ padding: "lg", className: "h-80" })} />
      </div>
    </main>
  );
}
