import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * The `/hello` segment's boundary, and what a navigation into it paints while
 * the locale and the pricing offer are read (ADR 20260804-instant-navigation).
 * Bars only, shaped like the hero (the note line, the heading, the lede and the
 * two doors), so the page lands where they stood. Nothing here is interactive,
 * so nothing a visitor does is lost when the body arrives.
 */
export default function HelloLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <Pending as="main" className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-7xl px-6 py-12 lg:py-20">
            <div className="max-w-3xl">
              <Bone className="h-4 w-48" />
              <Bone className="mt-4 h-10 w-full sm:h-14" />
              <Bone className="mt-2 h-10 w-2/3 sm:h-14" />
              <Bone className="mt-6 h-6 w-full" />
              <Bone className="mt-2 h-6 w-full" />
              <Bone className="mt-2 h-6 w-3/4" />
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Bone className="h-11 w-full sm:w-44" />
                <Bone className="h-11 w-full sm:w-52" />
              </div>
              <Bone className="mt-6 h-4 w-full" />
              <Bone className="mt-2 h-4 w-1/2" />
            </div>
          </div>
        </section>
      </Pending>
      <MarketingFooterFallback />
    </div>
  );
}
