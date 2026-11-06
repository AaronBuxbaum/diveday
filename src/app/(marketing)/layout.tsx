import { type ReactNode, Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";

/**
 * The marketing face's one header, drawn once for the pages in this group
 * (home, product, pricing, switching, about, status, terms, privacy). A page
 * here is a body: it renders its own footer and no nav, and a segment's
 * `loading.tsx` paints bars for the body only, because the bar above it never
 * unmounts across a navigation inside the group.
 *
 * `MarketingNav` reads the session and the negotiated locale, so it streams
 * behind {@link MarketingNavFallback} (the signed-out, default-locale header
 * almost every visitor gets anyway). The fallback is the same `ChromeBar`, at
 * the same `--chrome-h`, so nothing below it moves when the real one lands.
 *
 * The funnel's own doors (`/onboard`, `/get-set-up`) stay outside the group as
 * `EntryShell` wordmark doors: the wordmark and the form, no bar.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      {children}
    </div>
  );
}
