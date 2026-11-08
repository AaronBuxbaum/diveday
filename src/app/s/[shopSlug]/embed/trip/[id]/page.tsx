import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { uuidParam } from "@/lib/uuid";
import { EmbedChromeCollapse } from "../../../_components/EmbedChromeCollapse";
import { publicTripMetadata } from "../../../trips/[id]/_lib/page-metadata";
import { TripDetailPage } from "../../../trips/[id]/TripDetail";

// The frame paints inside its own shell like every route (ADR
// 20260804-instant-navigation), and that shell is the reason this segment
// exists: its `loading.tsx` is the frame's column rather than the page's.
export const instant = true;

/** The departure's own, canonical and all: a frame points search engines at the page. */
export function generateMetadata(props: {
  params: Promise<{ shopSlug: string; id: string }>;
}): Promise<Metadata> {
  return publicTripMetadata(props);
}

/**
 * **The framed trip page** (K-382; ADR 20260726-schedule-embed, amendment
 * 2026-11-03). A shop's calendar rows and a departure's lightbox open this
 * path; it is framable because of where it is (`isEmbedRoute` in
 * `src/lib/embed-routes.ts`), and nothing in its query can make it otherwise.
 *
 * It is the trip page itself, in embed mode, and nothing else: the booking,
 * its capacity check and its server actions stay in one place.
 * `EmbedChromeCollapse` goes on keeping the layout's chrome bar hidden if this
 * lands before the chrome does.
 */
export default async function EmbeddedTripPage({
  params,
  searchParams,
}: Omit<Parameters<typeof TripDetailPage>[0], "isEmbed">) {
  // The trip page narrows the id before its first read too; this file sits
  // under `[id]` as well, and a junk id is a 404 here rather than something a
  // reader has to follow into another file to see (scripts/check-uuid-segments.mjs).
  const { id } = await params;
  if (!uuidParam(id)) notFound();
  return (
    <>
      <EmbedChromeCollapse />
      <TripDetailPage params={params} searchParams={searchParams} isEmbed />
    </>
  );
}
