import type { Metadata } from "next";
import { EmbedChromeCollapse } from "../../_components/EmbedChromeCollapse";
import SchedulePage, { generateMetadata as scheduleMetadata } from "../../page";

// The frame paints inside its own shell like every route (ADR
// 20260804-instant-navigation), and that shell is the reason this segment
// exists: its `loading.tsx` is the frame's list rather than the storefront's.
export const instant = true;

/** The storefront's own, canonical and all: a frame points search engines at the page. */
export function generateMetadata(props: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  return scheduleMetadata(props);
}

/**
 * **The framed schedule** (K-371; ADR 20260726-schedule-embed, amendment
 * 2026-09-25). `src/proxy.ts` rewrites `/s/<slug>?embed=1` here
 * (`embedRenderPath` in `src/lib/embed-routes.ts`), because a segment's
 * `loading.tsx` cannot read a query string: under the storefront's own
 * segment the frame streamed in under a `max-w-6xl` identity band and then
 * snapped to a 12px-inset list. It refuses this path in any shape but the one
 * its rewrite gives it (`isInternalEmbedRoute`).
 *
 * It is the storefront page itself, in embed mode, and nothing else: the
 * booking and capacity logic stay in one place, which is the reason this ADR
 * reused the page rather than building a parallel surface. The mode is set
 * here as well as by the query the rewrite carries, so this segment can never
 * render the full storefront. `EmbedChromeCollapse` goes on keeping the
 * layout's chrome bar hidden if this lands before the chrome does.
 */
export default function EmbeddedSchedulePage({
  params,
  searchParams,
}: Parameters<typeof SchedulePage>[0]) {
  return (
    <>
      <EmbedChromeCollapse />
      <SchedulePage
        params={params}
        searchParams={searchParams.then((query) => ({ ...query, embed: "1" }))}
      />
    </>
  );
}
