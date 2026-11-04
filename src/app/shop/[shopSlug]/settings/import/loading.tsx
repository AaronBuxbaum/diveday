import { SectionTabs } from "@/components/SectionTabs";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header, tabs and honesty-table skeleton, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader pending description={false} />
        <SectionTabs pending count={4} />
        <SectionTabs pending count={3} />
        <SectionCard as="div" pending padding="lg">
          <Bone className="h-5 w-44" />
          <div className="mt-4 space-y-2">
            {["a", "b", "c", "d", "e", "f"].map((slot) => (
              <Bone shape="inset" key={slot} className="h-12" />
            ))}
          </div>
        </SectionCard>
      </Pending>
    </main>
  );
}
