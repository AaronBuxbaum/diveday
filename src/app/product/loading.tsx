import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { groupLabelClass } from "@/components/ui/ledger";
import {
  DISPLAY_TITLE_CLASS,
  MARKETING_EYEBROW_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/ui/typography";
import { FEATURE_PHASES, featurePagesIn } from "@/lib/feature-pages";
import { hubOnlyCapabilityGroups } from "@/lib/marketing";

/**
 * The `/product` segment's `<Suspense>` boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation).
 *
 * It stands in for the *whole* page, not just its main column, because the
 * page's own request-scoped read — `requestLocale()` — sits above everything
 * it renders. So the chrome is here too, and it is the real thing rather than
 * a grey bar: `MarketingNavFallback` and `MarketingFooterFallback` are the
 * signed-out, default-locale header and footer, which is what the
 * overwhelming majority of visitors to this page get anyway.
 *
 * The body is bars. That is the point of this file and not an economy: the
 * page it replaces used to paint a **whole second copy of itself in English**
 * as its fallback, and a visitor who tapped the chapter strip it had then had
 * the tap thrown away when the localized body swapped in
 * (FU-20260812-marketing-suspense-swap-discards-interaction). A skeleton has
 * nothing to tap, so there is nothing to lose. Anything interactive added to
 * this file reopens that bug.
 *
 * Shaped like the hero and the list under it, so the streamed page lands
 * where the bars stood instead of shifting under a reader who has already
 * started scrolling. The hero's bars are its line boxes, `h-lh` in the type of
 * the text they stand for, as many as the English wraps to at 1280 and at a
 * 390px phone (`SkeletonLineBars`, the phone's extra lines `sm:hidden`); a
 * rewrite that changes how the title or the lede wraps changes these counts
 * (K-409). The list draws one row per feature page under each phase, read off
 * the same registry the page reads, so a page added there is a row here too: a
 * name line, two summary lines (what most pages wrap to in a third of 1280 and
 * on a phone), and the 44px row that counts the page's checklist. The hub-only
 * groups follow, one titled row each, off `hubOnlyCapabilityGroups`, and the
 * sentence that counts every line closes it.
 */
export default function ProductLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        {/* Hero: eyebrow, the title, the lede, the CTA pair, the demo note and
            the price line, left-aligned on the list's own column. */}
        <section>
          <div className="mx-auto max-w-6xl px-6 pt-20 pb-12 lg:pt-28">
            <SkeletonLineBars lines={1} height={`h-lh ${MARKETING_EYEBROW_CLASS}`} width="w-40" />
            <div className="mt-5 max-w-4xl">
              <SkeletonLineBars
                lines={{ base: 3, sm: 2 }}
                height={`h-lh ${DISPLAY_TITLE_CLASS} sm:text-6xl`}
                width="w-full"
              />
            </div>
            <div className="mt-6 max-w-2xl">
              <SkeletonLineBars
                lines={{ base: 5, sm: 3 }}
                height="h-lh text-lg leading-8"
                width="w-full"
              />
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
            </div>
            <div className="mt-3">
              <SkeletonLineBars
                lines={{ base: 2, sm: 1 }}
                height="h-lh text-sm"
                width="w-72 max-w-full"
              />
            </div>
            <div className="mt-2">
              <SkeletonLineBars
                lines={{ base: 2, sm: 1 }}
                height="h-lh text-sm"
                width="w-80 max-w-full"
              />
            </div>
          </div>
        </section>

        {/* The list: each phase's label over one row per page (a name, its
            summary, and the row counting its checklist) between hairlines,
            three columns from lg; then the hub-only groups and the count. */}
        <section className="mx-auto max-w-6xl px-6 pb-20 lg:pb-24">
          <div className="grid gap-x-10 gap-y-12 lg:grid-cols-3">
            {FEATURE_PHASES.map((phase) => (
              <div key={phase}>
                <SkeletonLineBars
                  lines={1}
                  height={`h-lh ${groupLabelClass("primary")}`}
                  width="w-36"
                />
                <ul className="mt-4 border-t border-border">
                  {featurePagesIn(phase).map((page) => (
                    <li key={page.slug} className="border-b border-border pt-4">
                      <SkeletonLineBars
                        lines={1}
                        height={`h-lh ${SECTION_TITLE_CLASS}`}
                        width="w-48 max-w-full"
                      />
                      <div className="mt-1">
                        <SkeletonLineBars
                          lines={2}
                          height="h-lh text-sm leading-6"
                          width="w-full"
                        />
                      </div>
                      <div className="flex min-h-11 items-center">
                        <div className="h-5 w-20 rounded bg-surface-sunken" />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="lg:col-span-3">
              <SkeletonLineBars
                lines={1}
                height={`h-lh ${groupLabelClass("primary")}`}
                width="w-36"
              />
              <ul className="mt-4 grid border-t border-border lg:grid-cols-3 lg:gap-x-10 lg:border-t-0">
                {hubOnlyCapabilityGroups.map((id) => (
                  <li key={id} className="border-b border-border lg:border-t">
                    <div className="flex min-h-14 items-center justify-between gap-4 py-4">
                      <div
                        className={`h-lh w-40 rounded bg-surface-sunken ${SECTION_TITLE_CLASS}`}
                      />
                      <div className="h-5 w-20 shrink-0 rounded bg-surface-sunken" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-12 max-w-2xl">
            <SkeletonLineBars
              lines={{ base: 2, sm: 1 }}
              height="h-lh text-lg leading-8"
              width="w-full"
            />
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
