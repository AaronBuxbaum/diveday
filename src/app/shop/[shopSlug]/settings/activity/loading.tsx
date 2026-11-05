import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";
import { settingsPaneClass } from "../_components/settings-pane";

/** Bars for a placeholder list; a bar's place is its only identity. */
const LINES = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"] as const;

/**
 * The activity log's skeleton: the header, the toolbar's four controls and a
 * run of two-line entries, on the page's own rhythm (`space-y-10`, then the
 * section's `space-y-6`), so nothing jumps when the log arrives.
 */
export default function ShopActivityLoading() {
  return (
    <main className={settingsPaneClass()}>
      <Pending>
        <ShopPageHeader pending titleWidth="w-40" description={false} />
        <div className="space-y-10">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Bone shape="control" className="h-11 min-w-36 flex-1 sm:w-44 sm:flex-none" />
              <Bone shape="control" className="h-11 min-w-36 flex-1 sm:w-44 sm:flex-none" />
              <Bone shape="control" className="h-11 min-w-36 flex-1 sm:w-44 sm:flex-none" />
              <Bone shape="control" className="h-11 min-w-36 flex-1 sm:w-44 sm:flex-none" />
            </div>
            <ol className="grid gap-2">
              {LINES.map((line) => (
                <Bone as="li" shape="control" key={line} className="h-15" />
              ))}
            </ol>
          </div>
        </div>
      </Pending>
    </main>
  );
}
