import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";
import { registerPaneClass } from "../_components/register-pane";

export default function SafetyChecklistLoading() {
  return (
    <main className={registerPaneClass()}>
      <Pending>
        {/* "Pre-departure checklist" wraps to two lines at 390px and its
            description to three; one and two at 1280 (K-97). */}
        <ShopPageHeader
          pending
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
                <Bone className="h-4 w-2/3" />
              </div>
            ))}
          </div>
          <SectionCard as="div" pending padding="none" className="h-14" />
        </div>
      </Pending>
    </main>
  );
}
