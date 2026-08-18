import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Content-shaped skeleton for the schedule board (design principle 1). */
export default function ScheduleBoardLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" descriptionWidth="w-56" />
        <div className="mt-4 flex flex-col gap-8">
          {[0, 1, 2].map((day) => (
            <div key={day}>
              <div className="flex items-center gap-3 py-2">
                <div className="h-9 w-8 rounded bg-surface-sunken" />
                <div className="flex flex-col gap-1">
                  <div className="h-3 w-16 rounded bg-surface-sunken" />
                  <div className="h-3 w-20 rounded bg-surface-sunken" />
                </div>
                <div className="h-px min-w-8 flex-1 bg-border" />
                <div className="h-9 w-20 rounded-lg bg-surface-sunken" />
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {[0, 1].map((trip) => (
                  <div
                    key={trip}
                    className={sectionCardClass({ padding: "none", className: "h-24" })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
