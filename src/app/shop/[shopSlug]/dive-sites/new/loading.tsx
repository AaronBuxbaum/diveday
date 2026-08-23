import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Form-shaped skeleton for the new-dive-site editor (ADR
 * 20260804-instant-navigation).
 *
 * Without this file the route fell back to
 * `src/app/shop/[shopSlug]/dive-sites/loading.tsx`, the site *library*, at
 * `max-w-6xl` — so a staffer tapping "Add a dive site" watched a table
 * skeleton and landed on a narrow form. The width tracks the page's own
 * `max-w-3xl`, and the bars below stand in for the back link, the header, and
 * the stacked `FieldGrid` groups `SiteFields` renders, so the streamed form
 * lands where the skeleton stood.
 */
export default function NewDiveSiteLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        {/* The back link above the header. */}
        <div className="h-5 w-36 rounded bg-surface-sunken" />
        <div className="mt-4">
          <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-80 max-w-full" />
        </div>

        {/* The form's own `mt-8 flex flex-col gap-5`: label-over-control pairs,
            a two-up row for the coordinate fields, then the save button. */}
        <div className="mt-8 flex flex-col gap-5">
          {[0, 1].map((field) => (
            <div key={field}>
              <div className="h-4 w-28 rounded bg-surface-sunken" />
              <div className="mt-2 h-11 rounded-lg bg-surface-sunken" />
            </div>
          ))}
          <div className="grid gap-5 sm:grid-cols-2">
            {[0, 1].map((field) => (
              <div key={field}>
                <div className="h-4 w-24 rounded bg-surface-sunken" />
                <div className="mt-2 h-11 rounded-lg bg-surface-sunken" />
              </div>
            ))}
          </div>
          <div>
            <div className="h-4 w-32 rounded bg-surface-sunken" />
            <div className="mt-2 h-28 rounded-lg bg-surface-sunken" />
          </div>
          <div className="mt-2 h-12 w-48 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
