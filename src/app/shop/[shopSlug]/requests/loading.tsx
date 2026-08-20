import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for Requests (design principle 1) — a header, a date
 * heading with its count line, and the request cards under it.
 */
export default function RequestsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-72 max-w-full" descriptionWidth="w-96 max-w-full" />
        {[0, 1].map((section) => (
          <div key={section} className="mt-8">
            <div className="h-7 w-40 rounded bg-surface-sunken" />
            <div className="mt-2 h-4 w-56 rounded bg-surface-sunken" />
            <div className={sectionCardClass({ padding: "none", className: "mt-4 h-24" })} />
            <div className="mt-3 flex flex-col gap-3">
              {[0, 1].map((card) => (
                <div
                  key={card}
                  className={sectionCardClass({ padding: "none", className: "h-32" })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
