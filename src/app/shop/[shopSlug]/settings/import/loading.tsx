import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** Header + honesty-table skeleton, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description descriptionWidth="w-full max-w-xl" />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="h-5 w-44 rounded bg-surface-sunken" />
          <div className="mt-4 space-y-2">
            {["a", "b", "c", "d", "e", "f"].map((slot) => (
              <div key={slot} className="h-12 rounded-inset bg-surface-sunken" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
