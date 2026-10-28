import { SHOP_MAIN_CLASS } from "@/app/s/[shopSlug]/_components/shop-main";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a public course page (design principle 1): the
 * hero with title, facts and admission beside a retained supporting photo;
 * the anchor row; and the first prose bars of the overview.
 */
export default function CoursePageLoading() {
  return (
    <main className={SHOP_MAIN_CLASS}>
      <div className="animate-pulse">
        {/* The hero's own shell, from the same place `CourseHero` takes it. */}
        <div
          className={sectionCardClass({
            padding: "none",
            className: "overflow-hidden md:grid md:grid-cols-2 md:items-center",
          })}
        >
          <div className="p-6 sm:p-8">
            <ShopPageHeaderSkeleton
              titleWidth="w-80 max-w-full"
              description
              descriptionWidth="w-64 max-w-full"
            />
            <div className="h-8 w-44 max-w-full rounded bg-surface-sunken" />
            <div className="mt-5 h-9 w-32 rounded bg-surface-sunken" />
            <div className="mt-8 h-3 w-28 rounded bg-surface-sunken" />
            <div className="mt-2 h-6 w-64 max-w-full rounded bg-surface-sunken" />
            <div className="mt-6 h-11 w-36 rounded bg-surface-sunken" />
          </div>
          <div className="h-44 w-full bg-surface-sunken sm:h-56 md:h-80" />
        </div>
        <div className="mt-10 border-b border-border pb-4">
          <div className="h-5 w-80 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className="mt-8 max-w-2xl space-y-3">
          <div className="h-7 w-56 rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-2/3 rounded bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
