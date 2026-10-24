import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import {
  TripLookFor,
  TripRoutes,
  TripSiteNotes,
} from "@/app/s/[shopSlug]/trips/[id]/_components/TripDayPlan";
import type { SiteBriefing } from "@/app/s/[shopSlug]/trips/[id]/_components/types";
import { EmptyState } from "@/components/EmptyState";
import { JsonLd } from "@/components/JsonLd";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StoredPhoto } from "@/components/StoredPhoto";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import { getDb } from "@/db/client";
import {
  getDiveSiteBySlug,
  listDiveSiteBriefingExtras,
  listUpcomingDeparturesForSite,
} from "@/db/dive-sites";
import { withTranslatedFields } from "@/db/shop-text-translations";
import { shopBySlugCached } from "@/db/shops-cached";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestReaderUnits, requestTranslator } from "@/i18n/request";
import { diveSiteDepthText } from "@/i18n/unit-labels";
import { parseDiveSiteSlug } from "@/lib/dive-site-slug";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { publicDiveSitePath, publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { diveSitePageJsonLd } from "@/lib/structured-data";
import { capacityLabel } from "@/lib/trips";

// `instant = true`: the frame paints from this segment's `loading.tsx` while
// every request-scoped read below streams into it (ADR
// 20260804-instant-navigation). A page a search result opens cold is the one
// that can least afford to wait on a database round trip for its first pixel.
export const instant = true;

/**
 * The site row a public URL names, with its shop — or nothing, twice over.
 *
 * Memoized for the render: `generateMetadata` and the page body below both
 * need the same shop and the same site, and they used to read each of them
 * twice (issue #1737). `cache()` here is request-scoped, so a site the shop
 * renames is renamed on the next load.
 */
const resolveSite = cache(async (shopSlug: string, siteSlug: string) => {
  const slug = parseDiveSiteSlug(siteSlug);
  if (!slug) return null;
  const db = await getDb();
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return null;
  const site = await getDiveSiteBySlug(db, shop.id, slug);
  return site ? { db, shop, site } : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; siteSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug, siteSlug } = await params;
  const resolved = await resolveSite(shopSlug, siteSlug);
  // i18n-exempt: `generateMetadata` resolves ahead of locale negotiation, the
  // same reason a static `metadata.title` is exempt.
  if (!resolved) return { title: "Dive site — DiveDay" };
  const { shop, site } = resolved;
  const canonical = publicDiveSitePath(shop.slug, site.slug);
  const title = `${site.name} — ${shop.name}`;
  // The shop's own one-line summary of the place, or nothing. Never the
  // briefing's longer prose: a `<meta description>` assembled out of the first
  // paragraph of a dive plan reads as a truncated sentence in a search result.
  const description = site.description ?? undefined;
  return {
    title,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop),
    openGraph: { ...openGraphSite, title, description, url: canonical },
  };
}

/**
 * **One dive site, as the shop already wrote it** (N-48).
 *
 * A composition, not new content: every word here is on the `dive_sites` row
 * the shop filled in for its own briefings, and the three beats are the same
 * components the departure page renders them with — `TripRoutes`,
 * `TripSiteNotes`, `TripLookFor`. A diver who reads about
 * Molasses Reef here and then opens a Saturday going there sees the same
 * words in the same shapes, because they are the same components.
 *
 * The page exists because the search a diver actually runs is "Molasses Reef
 * diving", not the name of a shop they have never heard of. It is the one
 * public surface addressed by a *place*, and it ends where every DiveDay
 * public surface ends: on the departures a diver can book.
 *
 * Auth-exempt like the rest of `/s/**` — no session is read anywhere on it.
 */
export default async function DiveSitePage({
  params,
}: {
  params: Promise<{ shopSlug: string; siteSlug: string }>;
}) {
  await connection(); // "next departures" is live data — render per request
  const { shopSlug, siteSlug } = await params;
  const resolved = await resolveSite(shopSlug, siteSlug);
  if (!resolved) notFound();
  const { db, shop, site: siteRow } = resolved;
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  // The shop's own Spanish briefing for a reader in Spanish (`shop-translate`).
  const site = await withTranslatedFields(db, shop, locale, "dive_site", siteRow, [
    "description",
    "marineLifeDescription",
  ]);
  const [extras, departures] = await Promise.all([
    listDiveSiteBriefingExtras(db, shop.id, [site.id]),
    listUpcomingDeparturesForSite(db, shop.id, site.id),
  ]);
  // One "briefing", for one site and no tank: the beats read the place and
  // its field guide, and nothing about a dive
  // (`SiteBriefing`). The species words are DiveDay's, resolved here where the
  // reader's locale is known — never the shop's (ADR
  // 20260813-marine-life-is-diveday-copy).
  const briefings: SiteBriefing[] = [
    {
      diveSite: site,
      creatures: fieldGuideCards(extras.creatures.get(site.id) ?? [], t),
    },
  ];

  // The recorded range in the shop's unit, the same line the departure page's
  // day rows print, so the two surfaces never name different depths for one
  // reef. The shop's note stands in only where no depth is recorded. The
  // reader's unit follows the shop's when it differs (fifth-loop ideas, item 22).
  const readerDepth = (await requestReaderUnits(locale)).depth;
  const depth = diveSiteDepthText(t, site, shop.depthUnit, readerDepth);
  const difficulty = site.difficultyLevel ? diveSiteDifficultyLabel(site.difficultyLevel, t) : null;
  const snorkel =
    site.snorkelSuitable === true
      ? t("site.page.snorkelSuitable")
      : site.snorkelSuitable === false
        ? t("site.page.snorkelNotSuitable")
        : null;
  const bottomTime = site.expectedBottomTimeMinutes
    ? t("site.page.expectedBottomTime", { minutes: site.expectedBottomTimeMinutes })
    : null;
  const reqList = tripRequirementList(t, site, locale);
  const requirements = reqList ? t("site.page.requirements", { list: reqList }) : null;

  const facts = [site.locationName, depth, difficulty, bottomTime, snorkel, requirements].filter(
    (fact): fact is string => fact !== null,
  );
  const [cover = null, ...gallery] = site.imageUrls;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <JsonLd data={diveSitePageJsonLd(shop, site, publicAppUrl())} />
      <ShopPageHeader
        // The eyebrow is the way back up (principle 10's one grammar for up),
        // and the schedule is genuinely this page's parent: a site is a place
        // the board sends boats to.
        eyebrow={t("schedule.title")}
        eyebrowHref={publicSchedulePath(shop.slug)}
        title={site.name}
        titleFace="brand"
        description={site.description ?? undefined}
        meta={
          facts.length > 0 ? <p className="text-sm text-muted">{facts.join(" · ")}</p> : undefined
        }
        // The page's one act, above the fold. Everything between here and the
        // departures is the shop's own briefing — a route, a field guide, the
        // photographs divers brought back — and on a phone that is three
        // screens of reading before the dates. A reader who already knows they
        // want this reef should not have to scroll past the argument for it.
        // One control, not a second copy of the list: it lands on the same
        // rows, which stay where the pitch-then-ask grammar puts them (ADR
        // 20260827-the-divers-thread, decision 2).
        actions={
          departures.length > 0 ? (
            <Link href="#departures" className={buttonClass({ variant: "primary" })}>
              {t("site.page.jumpToDepartures")}
            </Link>
          ) : undefined
        }
      />
      {/* The shop's own photograph of the place, where it uploaded one. `alt`
          is empty on purpose: the `<h1>` two lines above says which reef this
          is, and an alt text repeating it makes a screen reader say the name
          twice for a picture that carries no other fact. */}
      {/* A lone second photo joins the cover in one strip (visual review
          2026-10-24, B50); it stood alone under the cover, a third of the
          width, with nothing beside it. */}
      {cover && gallery.length === 1 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StoredPhoto
            src={cover}
            alt=""
            className="aspect-[3/2] w-full rounded-panel sm:col-span-2 sm:aspect-auto sm:h-full"
            sizes="(min-width: 896px) 35rem, (min-width: 640px) 62vw, 100vw"
            priority
          />
          <StoredPhoto
            src={gallery[0] ?? cover}
            alt=""
            className="aspect-[3/2] w-full rounded-panel sm:aspect-[4/5]"
            sizes="(min-width: 896px) 17rem, (min-width: 640px) 30vw, 100vw"
          />
        </div>
      ) : (
        <>
          {cover ? (
            <StoredPhoto
              src={cover}
              alt=""
              className="aspect-[3/2] w-full rounded-panel sm:aspect-[5/2]"
              sizes="(min-width: 896px) 56rem, 100vw"
              priority
            />
          ) : null}
          {/* **Every photo the shop uploaded, not only the first.** The form takes
            six and this page drew one, so five reached no diver. The rest sit
            under the cover as a grid of tiles: two across on a phone, three
            from `sm`. Decorative for the same reason the cover is. */}
          {gallery.length > 0 ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {gallery.map((url) => (
                <li key={url}>
                  <StoredPhoto
                    src={url}
                    alt=""
                    className="aspect-[4/3] w-full rounded-inset"
                    sizes="(min-width: 896px) 17rem, (min-width: 640px) 30vw, 45vw"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <TripRoutes briefings={briefings} locale={locale} />
      <TripSiteNotes briefings={briefings} locale={locale} />
      <TripLookFor briefings={briefings} locale={locale} />

      {/* The page's one act. Everything above answers "would I like this
          reef?"; this answers "when can I go?", and each row is the door to
          the departure that already owns capacity, readiness and payment.
          `mt-6`, the step every beat above it stands at (pixel-craft class 4,
          K-509). */}
      <section id="departures" className="mt-6 scroll-mt-8">
        <GroupLabel as="h2">{t("site.page.departuresHeading")}</GroupLabel>
        {departures.length === 0 ? (
          <EmptyState
            className="mt-3"
            titleAs="h3"
            title={t("site.page.noDepartures")}
            action={
              <Link
                href={publicSchedulePath(shop.slug)}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("common.backToSchedule")}
              </Link>
            }
          />
        ) : (
          <ul className="mt-2">
            {departures.map((departure) => {
              const seats = capacityLabel(departure);
              return (
                <LedgerRow
                  key={departure.id}
                  href={publicTripPath(shop.slug, departure.id)}
                  linkLabel={departure.title}
                  trailing={
                    <span className="text-sm text-muted tabular-nums">
                      {seats.kind === "full"
                        ? t("fallback.full")
                        : t("fallback.spotsLeft", { count: seats.remaining })}
                    </span>
                  }
                >
                  <span className="block text-sm font-medium">
                    {formatShortDate(departure.startsAt, locale, shop.timezone)}
                  </span>
                  <span className="block text-sm text-muted tabular-nums">
                    {formatTimeRange(departure.startsAt, departure.endsAt, locale, shop.timezone)}
                  </span>
                </LedgerRow>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
