import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Form-shaped skeleton for the new-dive-site editor (ADR
 * 20260804-instant-navigation).
 *
 * Without this file the route fell back to
 * `src/app/shop/[shopSlug]/dive-sites/loading.tsx`, the site *library*, at
 * `max-w-6xl` — so a staffer tapping "Add a dive site" watched a table
 * skeleton and landed on a narrow form. It tracks the page's own shape: the
 * back link, the header, then the two columns the long-form editor pattern put
 * there — the section rail from `lg` up, the jump row below it, and unboxed
 * sections on hairlines rather than the bordered fieldsets that used to stand
 * here (ADR 20260827-the-shops-shelves).
 */
export default function NewDiveSiteLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
      <div className="animate-pulse">
        {/* The back link above the header. */}
        <div className="h-5 w-36 rounded bg-surface-sunken" />
        <div className="mt-4">
          <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-80 max-w-full" />
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
                <div key={entry} className="h-11 rounded-xl bg-surface-sunken" />
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
