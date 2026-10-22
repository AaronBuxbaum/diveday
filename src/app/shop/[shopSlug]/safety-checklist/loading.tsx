import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { registerPaneClass } from "../_components/register-pane";

export default function SafetyChecklistLoading() {
  return (
    <main className={registerPaneClass()}>
      <div className="animate-pulse">
        {/* "Pre-departure checklist" wraps to two lines at 390px and its
            description to three; one and two at 1280 (K-97). */}
        <ShopPageHeaderSkeleton
          titleWidth="w-56"
          titleLines={{ base: 2, sm: 1 }}
          description
          descriptionIsCaption
          descriptionWidth="w-full max-w-md"
          descriptionLines={{ base: 3, sm: 2 }}
        />
        <div className="space-y-10">
          <div>
            {[0, 1, 2].map((row) => (
              <div key={row} className={`${ledgerRowBoxClass} flex min-h-13 items-center py-2`}>
                <div className="h-4 w-2/3 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
          <div className={sectionCardClass({ padding: "none", className: "h-14" })} />
        </div>
      </div>
    </main>
  );
}
