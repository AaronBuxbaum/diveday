import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
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
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-40" description={false} />
        <div className="space-y-10">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-11 min-w-36 flex-1 rounded-lg bg-surface-sunken sm:w-44 sm:flex-none" />
              <div className="h-11 min-w-36 flex-1 rounded-lg bg-surface-sunken sm:w-44 sm:flex-none" />
              <div className="h-11 min-w-36 flex-1 rounded-lg bg-surface-sunken sm:w-44 sm:flex-none" />
              <div className="h-11 min-w-36 flex-1 rounded-lg bg-surface-sunken sm:w-44 sm:flex-none" />
            </div>
            <ol className="grid gap-2">
              {LINES.map((line) => (
                <li key={line} className="h-15 rounded-lg bg-surface-sunken" />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </main>
  );
}
