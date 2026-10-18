import { SectionTabsSkeleton } from "@/components/SectionTabs";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
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
      <div className="animate-pulse">
        {/* The download button sits beside the title. */}
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} actions />
        <SectionTabsSkeleton count={4} />
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "lg" })}>
            <div className="h-5 w-44 rounded bg-surface-sunken" />
            <div className="mt-2 h-4 w-56 rounded bg-surface-sunken" />
          </div>
          <div className={sectionCardClass({ padding: "lg" })}>
            <div className="h-5 w-44 rounded bg-surface-sunken" />
            <div className="mt-4 h-11 w-56 rounded-lg bg-surface-sunken" />
          </div>
        </div>
      </div>
    </main>
  );
}
