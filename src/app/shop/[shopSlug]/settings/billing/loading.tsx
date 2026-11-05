import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + the one plan card, at the page's own width, so the route never blocks blank. */
export default function BillingSettingsLoading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader pending titleWidth="w-40" description={false} />
        <SectionCard as="div" pending padding="none" className="h-56" />
      </Pending>
    </main>
  );
}
