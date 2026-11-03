import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { registerPaneClass } from "../_components/register-pane";

/** The fleet's compact summary rows, at the register's own width. */
export default function Loading() {
  return (
    <main className={registerPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeader pending titleWidth="w-56" description={false} />
        <SectionCard as="div" pending padding="none" className="divide-y divide-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-24 px-4 py-4 sm:px-5">
              <div className="h-4 w-36 rounded bg-surface-sunken" />
              <div className="mt-3 h-3 w-20 rounded bg-surface-sunken" />
            </div>
          ))}
        </SectionCard>
      </div>
    </main>
  );
}
