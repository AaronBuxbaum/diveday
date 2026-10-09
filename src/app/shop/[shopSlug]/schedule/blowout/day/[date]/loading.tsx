import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the day's weather call (ADR
 * 20260804-instant-navigation): the header with its date line, then the one
 * card at its own `max-w-2xl` — the lead and the money note, the departures
 * heading with its two presets, three ticked rows at the 44px row floor, and
 * the danger button. Mirrors the page's `<main>`, the trip family's
 * `max-w-5xl`, like the single-trip blow-out beside it.
 */
export default function DayBlowoutLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 animate-pulse px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeaderSkeleton
        titleWidth="w-72 max-w-full"
        description={false}
        meta={<div className="h-5 w-40 max-w-full rounded bg-surface-sunken" />}
      />
      <div className={sectionCardClass({ padding: "lg", className: "max-w-2xl" })}>
        <div className="flex flex-col gap-1">
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-1/2 rounded bg-surface-sunken" />
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-2/3 rounded bg-surface-sunken" />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="h-5 w-24 rounded bg-surface-sunken" />
          <div className="flex gap-2">
            <div className="h-11 w-32 rounded-lg bg-surface-sunken" />
            <div className="h-11 w-28 rounded-lg bg-surface-sunken" />
          </div>
        </div>
        <div className="mt-2 flex flex-col">
          {["w-48", "w-56", "w-44"].map((width) => (
            <div key={width} className="flex min-h-14 items-center gap-3 py-1">
              <div className="size-4 shrink-0 rounded bg-surface-sunken" />
              <div className="flex flex-col gap-1">
                <div className={`h-4 ${width} max-w-full rounded bg-surface-sunken`} />
                <div className="h-4 w-36 max-w-full rounded bg-surface-sunken" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 h-11 w-44 rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
