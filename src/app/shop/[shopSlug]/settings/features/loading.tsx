import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/** Skeleton for the Features list: the title, then one card holding the rows. */
export default function FeaturesLoading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader pending description={false} />
        <SectionCard as="div" pending padding="none" className="h-96" />
      </Pending>
    </main>
  );
}
