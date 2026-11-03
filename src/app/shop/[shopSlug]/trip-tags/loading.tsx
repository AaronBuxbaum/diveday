import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { registerPaneClass } from "../_components/register-pane";

/** Readable rows followed by the closed add disclosure at the page's own width. */
export default function Loading() {
  return (
    <main className={registerPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeader pending titleWidth="w-56" description={false} />
        <SectionCard as="div" pending padding="none" className="h-56" />
      </div>
    </main>
  );
}
