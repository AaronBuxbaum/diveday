import { SHOP_MAIN_CLASS } from "@/app/s/[shopSlug]/_components/shop-main";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for a public course page (design principle 1): the
 * hero with title and facts beside a retained supporting photo, then admission;
 * the anchor row; and the first prose bars of the overview.
 */
export default function CoursePageLoading() {
  return (
    <main className={SHOP_MAIN_CLASS}>
      <Pending>
        {/* The hero's own shell, from the same place `CourseHero` takes it. */}
        <SectionCard as="div" pending padding="none" className="overflow-hidden">
          <div className="md:grid md:grid-cols-2 md:items-start">
            <div className="p-6 sm:p-8">
              <ShopPageHeader
                pending
                titleWidth="w-80 max-w-full"
                description
                descriptionWidth="w-64 max-w-full"
              />
              <Bone className="h-8 w-44 max-w-full" />
              <Bone className="mt-5 h-9 w-32" />
            </div>
            <Bone shape="bleed" className="h-44 w-full sm:h-56 md:h-80" />
          </div>
          <div className="px-6 pb-6 sm:px-8 sm:pb-8">
            <Bone className="mt-8 h-3 w-28" />
            <Bone className="mt-2 h-6 w-64 max-w-full" />
            <Bone className="mt-6 h-11 w-36" />
          </div>
        </SectionCard>
        <div className="mt-10 border-b border-border pb-4">
          <Bone className="h-5 w-80 max-w-full" />
        </div>
        <div className="mt-8 max-w-2xl space-y-3">
          <Bone className="h-7 w-56" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-2/3" />
        </div>
      </Pending>
    </main>
  );
}
