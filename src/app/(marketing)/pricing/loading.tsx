import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/** The invoice's seven lines, as the page lists them. */
const INVOICE_ROWS = ["setup", "logins", "tiers", "cut", "cards", "contract", "leaving"] as const;

/** The marketing shell's container, the page's one left edge (B12). */
const CONTAINER = "mx-auto w-full max-w-7xl px-6";

/**
 * The `/pricing` segment's `<Suspense>` boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation). Same arrangement, and the
 * same reason, as `src/app/(marketing)/product/loading.tsx`: the page's `requestLocale()`
 * read sits above everything it renders, so the chrome is here too, and the
 * body is bars rather than a second English render of itself.
 *
 * Shaped like the page since the visual review of 2026-10-24 (B11, B12): one
 * container, start-aligned; the hero's eyebrow, title, figure and lock line;
 * the invoice beside one "Notes" list; the button pair; then the fee anchor
 * and the FAQ.
 */
export default function PricingLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <Pending as="main" className="flex-1">
        <section className="border-b border-border">
          <div className={`${CONTAINER} pt-20 pb-16 lg:pt-28 lg:pb-20`}>
            <Bone className="h-5 w-52" />
            <div className="mt-5">
              <SkeletonLineBars
                lines={{ base: 2, sm: 1 }}
                height="h-10 sm:h-12"
                width="w-full max-w-xl"
              />
            </div>
            <Bone className="mt-10 h-18 w-40 sm:h-24 sm:w-52" />
            <Bone className="mt-4 h-6 w-32" />
            <Bone className="mt-2 h-6 w-96 max-w-full" />

            {/* The annotated invoice, and the one Notes list beside it. */}
            <div className="mt-12 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
              <div className="divide-y divide-border border-y border-border">
                {INVOICE_ROWS.map((row) => (
                  <div key={row} className="flex items-center justify-between gap-6 py-3">
                    <Bone className="my-1 h-4 w-28" />
                    <Bone className="my-1 h-4 w-24" />
                  </div>
                ))}
              </div>
              <div>
                <Bone className="h-4 w-20" />
                <div className="mt-4 space-y-3">
                  {["note1", "note2", "note3", "note4", "note5"].map((note) => (
                    <Bone key={note} className="h-6 w-full" />
                  ))}
                </div>
                <div className="mt-4 flex h-12 items-center">
                  <Bone className="h-4 w-56" />
                </div>
              </div>
            </div>

            {/* The two doors, and the hero's footnotes under them. */}
            <div className="mt-12 flex flex-col gap-3 sm:flex-row">
              <Bone shape="control" className="h-12 w-full sm:w-48" />
              <Bone shape="control" className="h-12 w-full sm:w-36" />
            </div>
            <div className="mt-6">
              <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-6" width="w-full max-w-xl" />
            </div>
          </div>
        </section>

        {/* The fee anchor: heading, two quiet rows, the one line in full ink. */}
        <section className="border-b border-border">
          <div className={`${CONTAINER} py-16 lg:py-24`}>
            <div className="max-w-3xl">
              <Bone className="h-9 w-full max-w-lg" />
              <div className="mt-10 space-y-8">
                {[0, 1].map((row) => (
                  <div key={row}>
                    <Bone className="h-4 w-32" />
                    <Bone className="mt-3 h-4 w-full max-w-xl" />
                    <Bone className="mt-2 h-4 w-48" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </Pending>
      <MarketingFooterFallback />
    </div>
  );
}
