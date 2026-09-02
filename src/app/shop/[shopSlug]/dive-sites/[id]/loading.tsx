import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Form-shaped skeleton for one dive site's briefing (ADR
 * 20260804-instant-navigation).
 *
 * It used to draw four stacked cards, which is what the page looked like when
 * the briefing was a stack of bordered fieldsets. The page is a long-form
 * editor now — a section rail beside unboxed sections on hairlines (ADR
 * 20260827-the-shops-shelves) — so the skeleton is its twin, and the streamed
 * form lands where the bars stood instead of jumping a card's worth of
 * padding.
 */
export default function DiveSiteLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
      <div className="animate-pulse">
        {/* The back link above the header. */}
        <div className="h-5 w-36 rounded bg-surface-sunken" />
        <div className="mt-4">
          <ShopPageHeaderSkeleton titleWidth="w-72 max-w-full" descriptionWidth="w-full max-w-xl" />
        </div>

        <div className="mt-8 lg:grid lg:grid-cols-[13.75rem_1fr] lg:gap-x-14">
          {/* The jump row on a phone, the rail on a desktop — one list, two
              renderings, exactly as `EditorRail` renders them. */}
          <div className="mb-8 flex gap-2 border-b border-border pb-2 lg:hidden">
            {[0, 1, 2].map((entry) => (
              <div key={entry} className="h-9 w-24 rounded-lg bg-surface-sunken" />
            ))}
          </div>
          <div className="hidden lg:block">
            <div className="flex flex-col gap-0.5">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((entry) => (
                <div key={entry} className="h-11 rounded-inset bg-surface-sunken" />
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            {[0, 1, 2].map((section) => (
              <div key={section} className={section === 0 ? "" : "border-t border-border pt-6"}>
                <div className="h-3 w-32 rounded bg-surface-sunken" />
                <div className="mt-4 flex flex-col gap-5">
                  {[0, 1].map((field) => (
                    <div key={field}>
                      <div className="h-4 w-28 rounded bg-surface-sunken" />
                      <div className="mt-2 h-11 rounded-lg bg-surface-sunken" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* The one Save, in its sticky row. */}
            <div className="border-t border-border pt-3">
              <div className="h-11 w-40 rounded-lg bg-surface-sunken" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
