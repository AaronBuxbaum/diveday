import { SectionTabs } from "@/components/SectionTabs";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/**
 * Header, the four tabs of Your data, the bundle's (collapsed) summary card and
 * the crew-sheet card, so the route never blocks blank.
 *
 * The bundle's file list used to be modelled here as eight card-shaped bars,
 * because the section rendered open. It is a closed `<details>` now — a
 * heading and a file count — and a skeleton that promised the taller shape
 * would collapse the moment the page arrived, which is the jump these files
 * exist to prevent.
 */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        {/* The download button sits beside the title. */}
        <ShopPageHeader pending titleWidth="w-56" description={false} actions />
        <SectionTabs pending count={4} />
        <div className="space-y-10">
          <SectionCard as="div" pending padding="lg">
            <Bone className="h-5 w-44" />
            <Bone className="mt-2 h-4 w-56" />
          </SectionCard>
          <SectionCard as="div" pending padding="lg">
            <Bone className="h-5 w-44" />
            <Bone shape="control" className="mt-4 h-11 w-56" />
          </SectionCard>
        </div>
      </Pending>
    </main>
  );
}
