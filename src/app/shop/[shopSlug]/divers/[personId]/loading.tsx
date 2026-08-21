import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a diver's profile (design principle 1). Without
 * one, this route would inherit the Divers list's row-shaped skeleton from
 * the parent segment — a shape mismatch for a single profile page.
 *
 * The tiles take their shell from `sectionCardClass()`, the same call
 * `StatsSummary`'s calm stat card makes, and the same `gap-3` — a skeleton
 * squarer or wider-gapped than what replaces it is a layout jump on every
 * navigation into the record.
 */
export default function DiverProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-5 w-32 rounded bg-surface-sunken" />
        <div className="mt-4">
          <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="h-11 w-48 rounded-lg bg-surface-sunken" />
            <div className="h-11 w-36 rounded-lg bg-surface-sunken" />
          </div>
          <div className={sectionCardClass({ className: "mt-3 h-64" })} />
        </div>
        <div className="mt-8 h-11 w-full max-w-2xl rounded-xl bg-surface-sunken" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-6">
          {["waiver", "cards", "notes", "fit", "trips", "activity"].map((section) => (
            <div key={section} className={sectionCardClass({ className: "h-40" })} />
          ))}
        </div>
      </div>
    </main>
  );
}
