import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { uuidParam } from "@/lib/uuid";
import TripDetailPage, { generateMetadata as tripMetadata } from "../page";

// The frame paints inside its own shell like every route (ADR
// 20260804-instant-navigation), and that shell is the reason this segment
// exists: its `loading.tsx` is the frame's column rather than the page's.
export const instant = true;

/** The departure's own, canonical and all: a frame points search engines at the page. */
export function generateMetadata(props: {
  params: Promise<{ shopSlug: string; id: string }>;
}): Promise<Metadata> {
  return tripMetadata(props);
}

/**
 * **The framed trip page** (K-382; ADR 20260726-schedule-embed, amendment
 * 2026-09-25). `src/proxy.ts` rewrites `/s/<slug>/trips/<id>?embed=1` here
 * (`embedRenderPath` in `src/lib/embed-routes.ts`) and refuses this path to
 * anybody who asks for it by name, because a segment's `loading.tsx` cannot
 * read a query string: under the trip page's own segment a shop's booking
 * widget painted a centred 528px column and then snapped to the frame's.
 *
 * It is the trip page itself, in embed mode, and nothing else: the booking,
 * its capacity check and its server actions stay in one place. The mode is set
 * here as well as by the query the rewrite carries, so this segment can never
 * render the unframed page.
 */
export default async function EmbeddedTripPage({
  params,
  searchParams,
}: Parameters<typeof TripDetailPage>[0]) {
  // The page below narrows the id before its first read too; this file sits
  // under `[id]` as well, and a junk id is a 404 here rather than something a
  // reader has to follow into another file to see (scripts/check-uuid-segments.mjs).
  const { id } = await params;
  if (!uuidParam(id)) notFound();
  return (
    <TripDetailPage
      params={params}
      searchParams={searchParams.then((query) => ({ ...query, embed: "1" }))}
    />
  );
}
