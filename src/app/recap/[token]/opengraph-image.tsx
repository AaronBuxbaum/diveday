import { ImageResponse } from "next/og";
import { getDb } from "@/db/client";
import { getRecapPageData } from "@/db/recap";
import { formatShortDate } from "@/lib/format";
import { verifyRecapToken } from "@/lib/recap-links";

// i18n-exempt-file: link-preview card rendered for crawlers with no visitor
// locale context, the same carve-out as the root `opengraph-image.tsx`.
/**
 * The unfurl card for a shared recap link (task 59 — `recap-links.ts` calls
 * the link "shareable" but nothing made it shareable before this). This is a
 * *bearer-token* page: the token in the URL is the only credential, so
 * anyone holding the link already sees the full page — but an unfurl preview
 * (Slack, iMessage, ...) renders for bystanders in that channel who never
 * clicked the link at all. Kept to the same non-personal facts a signed-out
 * visitor of the shop's own public schedule page already sees — the trip
 * title and the dive site names — and never the diver's name, contact info,
 * photos, review words, or tip amount (checked against
 * docs/engineering/capability-telemetry-runbook.md). An invalid or
 * unreachable token renders the same generic DiveDay card a dead link would,
 * disclosing nothing about why.
 */
export const alt = "A DiveDay dive recap.";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

const CARD_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  padding: 72,
  backgroundColor: "#071720",
  backgroundImage: "linear-gradient(160deg, #071720 55%, #0d222d 100%)",
  color: "#e9f3f4",
  fontSize: 32,
};

const WORDMARK = (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <div
      style={{ width: 28, height: 28, borderRadius: 9999, backgroundColor: "#22d3ee", display: "flex" }}
    />
    <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
      DiveDay
      <span style={{ color: "#ff8a7e" }}>.</span>
    </div>
  </div>
);

function genericCard() {
  return new ImageResponse(
    <div style={CARD_STYLE}>
      {WORDMARK}
      <div style={{ display: "flex", fontSize: 56, fontWeight: 600, letterSpacing: "-0.03em" }}>
        A dive recap
      </div>
      <div style={{ display: "flex", fontSize: 28, color: "#22d3ee" }}>
        A calmer way to run a dive day
      </div>
    </div>,
    size,
  );
}

export default async function RecapOpenGraphImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const bookingId = verifyRecapToken(token);
  if (!bookingId) return genericCard();

  const db = await getDb();
  const data = await getRecapPageData(db, bookingId);
  if (!data) return genericCard();

  const { shop, trip, sites } = data;
  const when = formatShortDate(trip.startsAt, shop.defaultLocale, shop.timezone);
  const siteNames = sites.map((s) => s.name);
  const siteLine =
    siteNames.length > 0
      ? new Intl.ListFormat(shop.defaultLocale, { type: "conjunction" }).format(siteNames)
      : null;

  return new ImageResponse(
    <div style={CARD_STYLE}>
      {WORDMARK}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", fontSize: 30, color: "#9fc0c7" }}>{shop.name}</div>
        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            maxWidth: 1000,
          }}
        >
          {trip.title}
        </div>
        {siteLine ? (
          <div style={{ display: "flex", fontSize: 32, color: "#9fc0c7", maxWidth: 1000 }}>
            {siteLine}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", fontSize: 28, color: "#22d3ee" }}>{when} · Dive recap</div>
    </div>,
    size,
  );
}
