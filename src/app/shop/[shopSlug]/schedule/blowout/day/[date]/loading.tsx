import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for the day's weather call (ADR
 * 20260804-instant-navigation): the header with its date line, then the one
 * card — the lead and the money note, the departures heading with its two
 * presets, three ticked rows at the 44px row floor, and the danger button.
 * Mirrors the page's `<main>`, a staff page at `reading` width, like the
 * single-trip blow-out beside it (visual review 2026-10-24, layer 7: the card
 * had sat left on a full-width page).
 */
export default function DayBlowoutLoading() {
  return (
    <Pending as={StaffPage} width="reading">
      <ShopPageHeader
        pending
        titleWidth="w-72 max-w-full"
        description={false}
        meta={<Bone className="h-5 w-40 max-w-full" />}
      />
      <SectionCard as="div" pending padding="lg">
        <div className="flex flex-col gap-1">
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-1/2" />
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-2/3" />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <Bone className="h-5 w-24" />
          <div className="flex gap-2">
            <Bone shape="control" className="h-11 w-32" />
            <Bone shape="control" className="h-11 w-28" />
          </div>
        </div>
        <div className="mt-2 flex flex-col">
          {["w-48", "w-56", "w-44"].map((width) => (
            <div key={width} className="flex min-h-14 items-center gap-3 py-1">
              <Bone className="size-4 shrink-0" />
              <div className="flex flex-col gap-1">
                <Bone className={`h-4 ${width} max-w-full`} />
                <Bone className="h-4 w-36 max-w-full" />
              </div>
            </div>
          ))}
        </div>
        <Bone shape="control" className="mt-6 h-11 w-44" />
      </SectionCard>
    </Pending>
  );
}
