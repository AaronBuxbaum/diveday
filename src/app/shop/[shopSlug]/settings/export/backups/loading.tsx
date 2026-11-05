import { SectionTabs } from "@/components/SectionTabs";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../../_components/settings-pane";

/**
 * Header, the four tabs of Your data and the backups half (status card and
 * destination form), so the route never blocks blank.
 */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader pending titleWidth="w-56" description={false} />
        <SectionTabs pending count={4} />
        <div>
          <Bone className="h-5 w-28" />
          <div className="mt-4 space-y-6">
            <SectionCard as="div" pending padding="lg">
              <Bone className="h-5 w-44" />
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {["a", "b", "c", "d"].map((slot) => (
                  <Bone shape="control" key={slot} className="h-10" />
                ))}
              </div>
            </SectionCard>
            <SectionCard as="div" pending padding="lg">
              <Bone className="h-5 w-52" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {["a", "b", "c", "d", "e", "f"].map((slot) => (
                  <Bone shape="control" key={slot} className="h-11" />
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </Pending>
    </main>
  );
}
