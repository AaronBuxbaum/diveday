import { ImageResponse } from "next/og";
import { getDb } from "@/db/client";
import { getRecapPageData } from "@/db/recap";
import { formatShortDate } from "@/lib/format";
import { loadOgFonts, OG_FONT_FAMILY, type OgFont } from "@/lib/og-fonts";
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
  fontFamily: OG_FONT_FAMILY,
};

const WORDMARK = (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 9999,
        backgroundColor: "#22d3ee",
        display: "flex",
      }}
    />
    <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
      DiveDay
      <span style={{ color: "#ff8a7e" }}>.</span>
    </div>
  </div>
);

function genericCard(fonts: OgFont[]) {
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
    { ...size, fonts },
  );
}

export default async function RecapOpenGraphImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Before anything can return an ImageResponse: see src/lib/og-fonts.ts. Once
  // the response exists its body is already streaming, and a font resolved
  // lazily from inside that stream can only fail by severing the connection.
  const fonts = await loadOgFonts();

  // TEMPORARY DIAGNOSTIC — remove once the CI-only failure is understood.
  // The server's stderr is piped by playwright.config.ts, so this lands in the
  // repro job's log right above the `failed to pipe response` it explains.
  // Reports three things the earlier probes could not, because they called this
  // module directly and so never entered a request work-unit store — which is
  // what routes the render through Cache Components' cached-image path instead
  // of @vercel/og's plain one:
  //   - whether the fonts this process actually holds are the real files
  //   - which of the two render paths this request is on
  //   - whether rasterizing the very same SVG works here and now
  try {
    const { workUnitAsyncStorage } = await import(
      // biome-ignore lint/suspicious/noExplicitAny: internal, diagnostic only
      "next/dist/server/app-render/work-unit-async-storage.external" as any
    );
    const store = workUnitAsyncStorage?.getStore?.();
    let sharpProbe: string;
    try {
      const sharp = (await import("sharp")).default;
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
      );
      sharpProbe = `ok (${(await sharp(svg).resize(20).png().toBuffer()).length} bytes)`;
    } catch (error) {
      sharpProbe = `FAILED: ${(error as Error).message}`;
    }
    console.error(
      `[og-diag] token=${token.slice(0, 8)} store=${store?.type ?? "none"} fonts=${fonts
        .map((f) => `${f.weight}:${f.data.byteLength}`)
        .join(",")} sharpSvg=${sharpProbe}`,
    );
  } catch (error) {
    console.error(`[og-diag] probe threw: ${(error as Error).message}`);
  }

  const bookingId = verifyRecapToken(token);
  if (!bookingId) return genericCard(fonts);

  const db = await getDb();
  const data = await getRecapPageData(db, bookingId);
  if (!data) return genericCard(fonts);

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
    { ...size, fonts },
  );
}
