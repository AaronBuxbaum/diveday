import Link from "next/link";
import { Fragment } from "react";
import { canDrawRoute, DiveSiteMap } from "@/components/DiveSiteMap";
import { StoredPhoto } from "@/components/StoredPhoto";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";
import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS } from "@/i18n/next-dive-labels";
import { depthText } from "@/i18n/unit-labels";
import { NO_CERTIFICATION_ANSWER } from "@/lib/certification-options";
import { type DayProfileRow, dayProfileRows } from "@/lib/day-profile";
import { checkDepthCeiling, statedLevelDepthLimit } from "@/lib/depth-ceiling";
import type { DepthUnit } from "@/lib/depth-units";
import { DECLARABLE_CERTIFICATION_LEVELS } from "@/lib/dive-declaration";
import { type DiveSiteLandmarkKind, parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { type DiveMode, type DockDayRhythm, siteFit } from "@/lib/diver-planning";
import { formatShortDate } from "@/lib/format";
import { publicDiveSitePath } from "@/lib/public-routes";
import type { SiteSightings } from "@/lib/sightings";
import { nightSkyFor } from "@/lib/sky";
import { sunMoonFor } from "@/lib/sun-moon";
import { type DayCeilingOption, DayCeilingPicker } from "./DayCeilingPicker";
import { DaySkyLine } from "./DaySkyLine";
import { NightSkyLine } from "./NightSkyLine";
import type { DiveBriefing, Shop, SiteBriefing } from "./types";

/**
 * What the departure's own row and the shop's rhythm say about the shape of
 * the day — the inputs "The day" needs beyond the dives themselves.
 *
 * Optional on purpose: a caller with no shop in hand renders the run of dives
 * exactly as it always did, and a day whose figures say nothing renders none
 * of this.
 */
export type DayProfileFacts = {
  /** The shop's published rhythm; a `shops` row satisfies it. */
  rhythm: DockDayRhythm;
  depthUnit: DepthUnit;
  diveMode: DiveMode;
  /** How many days the departure meets on (`trip_schedule_days`). */
  dayCount: number;
};

/**
 * The five rungs plus "no card yet", each carrying the answer for this day
 * already written out (`DayCeilingPicker`).
 *
 * The comparison is `checkDepthCeiling`'s, the same one the staff roster's
 * depth advisory runs — in the shop's own unit, after rounding, because 18.288
 * m > 18 m is an artefact of storing feet as metres rather than a fact about
 * diving. And it is the same *kind* of answer: a warning, never a gate (H-08).
 */
function ceilingOptions(
  t: DiverTranslator,
  rows: readonly DayProfileRow[],
  unit: DepthUnit,
): DayCeilingOption[] {
  const dives = rows.filter((row) => row.kind === "dive");
  if (!dives.some((dive) => dive.siteMaxDepthMeters)) return [];
  return [...DECLARABLE_CERTIFICATION_LEVELS, null].map((level) => {
    const limit = statedLevelDepthLimit(level);
    const limitText = depthText(t, limit.ceiling.meters, unit);
    const deeper = dives.flatMap((dive) => {
      const check = checkDepthCeiling(dive.siteMaxDepthMeters, limit, unit);
      if (check.status !== "exceeds") return [];
      const values = {
        number: dive.number,
        site: depthText(t, dive.siteMaxDepthMeters ?? 0, unit),
        limit: limitText,
      };
      return [t(level ? "trip.dayProfile.over" : "trip.dayProfile.overNoCard", values)];
    });
    return {
      value: level ?? NO_CERTIFICATION_ANSWER,
      label: level ? t(DIVER_CERT_LEVEL_KEYS[level]) : t("common.certification.levelNone"),
      // A clean day still answers. A control that appears to do nothing when
      // the news is good teaches the reader it is broken.
      lines: deeper.length > 0 ? deeper : [t("trip.dayProfile.within", { limit: limitText })],
    };
  });
}

/**
 * **"Seen here this month"** — the crew's own log, under the site it is about.
 *
 * The shop's field guide one beat below says what a reef *may* show a diver and
 * is the shop's standing claim about a place. This is the other half of that
 * sentence and the half no dive shop's website has ever carried: how often the
 * thing has actually turned up lately, with a date on the last one.
 *
 * **It is a record, and it says so.** "Seen" is past tense on purpose, every
 * line is a frequency rather than an expectation, and the closing sentence
 * states the boundary outright — because a page that prints "turtles on 14 of
 * the last 16 dives" without it is one glance away from being read as a
 * promise, and the crew who wrote those rows would be the ones asked about it
 * on the boat.
 *
 * A site whose crew logged nothing this month renders nothing at all. Most
 * sites, most months, on most shops.
 */
function SiteSeen({
  seen,
  t,
  locale,
  timeZone,
  className,
}: {
  seen: SiteSightings;
  t: DiverTranslator;
  locale: string;
  /** The shop's own zone: "last seen" is a date, and a date names its zone. */
  timeZone: string;
  className?: string;
}) {
  // A slug the catalog has since retired has no words, and a line of raw slug
  // is worse than one line fewer — the same rule `fieldGuideCards` follows.
  const lines = seen.species.flatMap((tally) => {
    if (!isMarineLifeSlug(tally.speciesSlug)) return [];
    const card = marineLifeCard(tally.speciesSlug, t);
    return [
      {
        slug: tally.speciesSlug,
        line: t("trip.seen.line", {
          species: card.name,
          seen: tally.dives,
          dives: seen.dives,
        }),
        lastSeen: t("trip.seen.lastSeen", {
          date: formatShortDate(tally.lastSeenAt, locale, timeZone),
        }),
      },
    ];
  });
  if (lines.length === 0) return null;
  return (
    <div className={className}>
      <p className="text-sm font-medium">{t("trip.seen.heading")}</p>
      <ul className="mt-1 space-y-1">
        {lines.map((line) => (
          <li key={line.slug} className="text-sm leading-relaxed">
            <span className="block">{line.line}</span>
            <span className="block text-muted">{line.lastSeen}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm leading-relaxed text-muted">{t("trip.seen.honest")}</p>
    </div>
  );
}

/**
 * **"The day" and "Look for" — the pitch, in two ledger beats.**
 *
 * ADR 20260827-the-divers-thread, decision 2: the content that answers "is this
 * my day?" leads, and the form closes. The same facts used to arrive *below*
 * the booking form as `DiveBriefingsSection` — an eyebrow, a `text-2xl`
 * heading as loud as the page's own `h1`, a swipeable deck of photo cards and a
 * comparison table — roughly a thousand pixels of reading placed where only a
 * diver who had already paid would ever reach it. Slice 7c then took the deck
 * off `/ready` too and deleted it (H-49), so these two beats are the whole of
 * what the product says about what a day dives.
 *
 * What survives here is what a deciding diver actually needs: the run of dives
 * in plan order, and the species the shop has put on those sites' field guides.
 * Time-neutral on purpose — a dive plan's clock belongs to the day itself
 * (`PackingSection`'s dock-day rhythm on the thread), and a schedule printed
 * beside a Book button reads as a commitment the crew has not made.
 */
export function TripDayPlan({
  briefings,
  shop,
  startsAt,
  endsAt,
  locale,
  profile,
  sightings,
}: {
  briefings: DiveBriefing[];
  /**
   * The shop, for the coordinates and zone the sky line is computed from —
   * and for its own slug, which is half of every site page's URL.
   */
  shop: Pick<Shop, "slug" | "timezone" | "latitude" | "longitude">;
  /** When this departure leaves. */
  startsAt: Date;
  /** When it comes home — a departure still out at sunset dives in the dark. */
  endsAt: Date;
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  /**
   * The shop's rhythm and unit, when the caller has them. Without it the beat
   * is the run of dives it always was.
   */
  profile?: DayProfileFacts;
  /**
   * What each of the day's sites has shown lately, keyed by site id
   * (`siteSightings`). Absent, or missing a site, renders no beat for it —
   * which is every shop whose crews have not tapped a chip.
   */
  sightings?: ReadonlyMap<string, SiteSightings>;
}) {
  const t = diverTranslator(locale);
  // The sky belongs to the day, so it rides in this beat rather than opening a
  // section of its own — and a departure with no dive plan at all still gets
  // it, because "sunset is at 7:35" is a fact about the departure, not about
  // the sites nobody has picked yet.
  //
  // **The site's own coordinates, falling back to the shop's.** A shop with a
  // dock in Key Largo runs departures to the Dry Tortugas, and sunset there is
  // eighteen minutes later — small, and exactly the kind of small that reads as
  // the product being approximately right rather than right. The first site of
  // the day that carries a position speaks for the day; a shop that has set
  // neither its address nor a site's position carries no line at all, which is
  // the ordinary case for a shop that has done the least setup.
  const sitePlace = briefings
    .map(({ diveSite }) => diveSite)
    .find((site) => site?.forecastLatitude != null && site?.forecastLongitude != null);
  const latitude = sitePlace?.forecastLatitude ?? shop.latitude;
  const longitude = sitePlace?.forecastLongitude ?? shop.longitude;
  const nightSky = nightSkyFor({
    startsAt,
    endsAt,
    timeZone: shop.timezone,
    latitude,
    longitude,
  });
  const sunMoon = sunMoonFor({ at: startsAt, timeZone: shop.timezone, latitude, longitude });
  // Two ends of one fact, and a departure is only ever one of them: a day trip
  // wants the light it has, a night charter wants the dark and the moon it will
  // dive under. Neither wants the other's half.
  const sky = nightSky ? (
    <NightSkyLine sky={nightSky} timeZone={shop.timezone} locale={locale} />
  ) : (
    <DaySkyLine
      sunriseAt={sunMoon?.sunriseAt ?? null}
      sunsetAt={sunMoon?.sunsetAt ?? null}
      timeZone={shop.timezone}
      locale={locale}
    />
  );
  if (briefings.length === 0) {
    return nightSky || sunMoon?.sunriseAt ? (
      <section className="mt-8">
        <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
        {sky}
      </section>
    ) : null;
  }
  // Durations, never a clock. The beat stays time-neutral — the day's hours
  // belong to the thread a booked diver walks — but how long a dive runs and
  // how long the boat sits between two of them are facts about the day itself,
  // and a diver deciding whether it is theirs was reading neither.
  const rows = profile
    ? dayProfileRows({
        dives: briefings.map(({ dive, diveSite }) => ({
          number: dive.diveNumber,
          siteMaxDepthMeters: diveSite?.maxDepthMeters ?? null,
          siteBottomTimeMinutes: diveSite?.expectedBottomTimeMinutes ?? null,
          travelMinutes: dive.travelMinutes,
        })),
        rhythm: profile.rhythm,
        diveMode: profile.diveMode,
        dayCount: profile.dayCount,
      })
    : [];
  const bottomTimes = new Map(
    rows.flatMap((row) => (row.kind === "dive" ? [[row.number, row.bottomTimeMinutes]] : [])),
  );
  const intervals = new Map(
    rows.flatMap((row) =>
      row.kind === "surfaceInterval" ? [[row.afterDiveNumber, row.minutes]] : [],
    ),
  );
  const options = profile ? ceilingOptions(t, rows, profile.depthUnit) : [];
  // One beat per *site*, not per tank: a two-tank day on one mooring would
  // otherwise print the same month twice, the way the route and the site prose
  // used to before they were deduplicated.
  const seenShown = new Set<string>();
  // A day where nothing is decided yet says so once. Two rows both reading
  // "Site to be confirmed" opened the sparse course session's pitch with the
  // one thing the shop has not decided, stated twice (principle 9; 2026-08-28
  // diver-views review, finding 10). The count survives — it is the one fact
  // those rows carried.
  if (briefings.every(({ dive, diveSite }) => !dive.title && !diveSite)) {
    return (
      <section className="mt-8">
        <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
        {sky}
        <p className="mt-2 text-sm text-muted">
          {t("trip.sitesToBeConfirmed", { count: briefings.length })}
        </p>
      </section>
    );
  }
  return (
    <section className="mt-8">
      <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
      {sky}
      <ul className="mt-2">
        {briefings.map(({ dive, diveSite }) => {
          const bottomTime = bottomTimes.get(dive.diveNumber) ?? null;
          const interval = intervals.get(dive.diveNumber) ?? null;
          // The shop's own range where it wrote one ("18–40 m"), and the site's
          // maximum where it did not. Without the fallback a day could name a
          // depth in the ceiling sentence below that appears nowhere in the
          // list the sentence is about.
          // The crew's month for this site, once. `seenShown` is mutated during
          // the render of a list this component builds itself, in order, on the
          // server — the same shape `fieldGuideCardsFor` and `routeSitesFor`
          // use one beat below.
          const seen = diveSite && !seenShown.has(diveSite.id) ? sightings?.get(diveSite.id) : null;
          if (seen && diveSite) seenShown.add(diveSite.id);
          const depth =
            diveSite?.depthRange ??
            (profile && diveSite?.maxDepthMeters
              ? depthText(t, diveSite.maxDepthMeters, profile.depthUnit)
              : null);
          // **The site's name is the door to its own page** (N-48). The whole
          // of what the shop wrote about a place — the prose, the drawn route,
          // the field guide, the diver photos, and every other departure going
          // there — lives at `/s/<shop>/sites/<site>`, and this run of rows is
          // the one beat on this page that names every site the day dives. A
          // page reachable only from a sitemap is a page divers never find.
          const siteHref = diveSite ? publicDiveSitePath(shop.slug, diveSite.slug) : null;
          const lead = dive.title ?? diveSite?.name ?? t("trip.siteToBeConfirmed");
          // Linked once per row, on whichever line carries the site's name: a
          // dive the shop named after its site has one line, not two.
          const leadNamesSite = Boolean(diveSite && lead === diveSite.name);
          return (
            <Fragment key={dive.id}>
              <LedgerRow
                kind={{ word: t("trip.diveNumber", { number: dive.diveNumber }), tone: "neutral" }}
                trailing={
                  depth ? <span className="text-sm text-muted tabular-nums">{depth}</span> : null
                }
              >
                <span className="block text-sm font-medium">
                  {siteHref && leadNamesSite ? (
                    <Link href={siteHref} className="text-primary hover:underline">
                      {lead}
                    </Link>
                  ) : (
                    lead
                  )}
                </span>
                {/* The site under the dive's own name, when the shop gave the dive
                    a name of its own that is not simply the site's. A departure
                    whose second tank has no site yet says so here rather than
                    reading as a one-site day. */}
                {dive.title && diveSite?.name && dive.title !== diveSite.name ? (
                  <span className="block text-sm">
                    {siteHref ? (
                      <Link href={siteHref} className="text-primary hover:underline">
                        {diveSite.name}
                      </Link>
                    ) : (
                      <span className="text-muted">{diveSite.name}</span>
                    )}
                  </span>
                ) : null}
                {dive.title && !diveSite ? (
                  <span className="block text-sm text-muted">{t("trip.siteToBeConfirmed")}</span>
                ) : null}
                {bottomTime ? (
                  <span className="block text-sm text-muted tabular-nums">
                    {t("trip.dayProfile.bottomTime", { minutes: bottomTime })}
                  </span>
                ) : null}
              </LedgerRow>
              {/* **Its own row, past the kind word**, not inside the dive's
                  children column. At 390px that column is what is left after
                  the kind gutter and the trailing depth — about a third of the
                  screen — and three sentences of reading set in it wrapped
                  every line twice. The surface interval below already has this
                  shape for the same reason. */}
              {seen ? (
                <li className="flex gap-3 border-t border-border py-2">
                  <span className="min-w-23 shrink-0" />
                  <SiteSeen
                    seen={seen}
                    t={t}
                    locale={locale}
                    timeZone={shop.timezone}
                    className="min-w-0 flex-1"
                  />
                </li>
              ) : null}
              {/* The gap, on the hairline between the two dives it belongs to.
                  Indented past the kind word so it reads as part of the run
                  rather than as a third dive. */}
              {interval ? (
                <li className="flex items-center gap-3 border-t border-border py-2">
                  <span className="min-w-23 shrink-0" />
                  <span className="text-sm text-muted tabular-nums">
                    {t("trip.dayProfile.surfaceInterval", { minutes: interval })}
                  </span>
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ul>
      {/* Nothing is submitted and nothing is gated: the reader names a card,
          and the day answers back (H-08). */}
      {options.length > 0 ? (
        <DayCeilingPicker
          label={t("trip.dayProfile.pickerLabel")}
          unsaidLabel={t("common.certification.levelUnsaid")}
          options={options}
        />
      ) : null}
    </section>
  );
}

/**
 * The species the shop chose for this day's sites — each one a face, a quick
 * field note, and a way to spot it, not a line of names.
 *
 * DiveDay writes the words and ships the photos (ADR
 * 20260813-marine-life-is-diveday-copy), so every card arrives with its
 * `imageUrl` already resolved by `fieldGuideCards`. Slice 7c rendered only the
 * names, which left the one guaranteed-illustrated dataset in the product — 149
 * bundled, licensed species photos — reaching no diver anywhere. The
 * description and preparation tip are the same localized catalog copy used by
 * the field-guide editor; no public claim is invented here. The photo is
 * decorative (`alt=""`): the visible name beside it is the content, so a screen
 * reader hears each species once.
 *
 * Deduplicated by name because a two-tank day on one mooring carries the same
 * guide twice, and renders nothing at all when no site names a species — an
 * empty "Look for" is a heading apologising for having nothing under it.
 */
/**
 * The day's field guide as one list: every species its sites name, in plan
 * order, deduplicated because a two-tank day on one mooring carries the same
 * guide twice.
 *
 * Exported so `TripPitch`'s three tiles and the full list below read the same
 * list in the same order — a preview that disagreed with what the door opens
 * would be the worst of both.
 */
export function fieldGuideCardsFor(briefings: readonly SiteBriefing[]) {
  const seen = new Set<string>();
  return briefings.flatMap(({ creatures }) =>
    creatures.filter((creature) => {
      const key = creature.slug ?? creature.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

export function TripLookFor({ briefings, locale }: { briefings: SiteBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const cards = fieldGuideCardsFor(briefings);
  if (cards.length === 0) return null;
  return (
    <section className="mt-6">
      <GroupLabel as="h2">{t("trip.lookFor")}</GroupLabel>
      <ul className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.slug ?? card.name} className="flex min-w-0 gap-3">
            <StoredPhoto
              src={card.imageUrl}
              alt=""
              className="size-12 shrink-0 rounded-inset"
              sizes="48px"
            />
            <div className="min-w-0">
              <p className="font-medium">{card.name}</p>
              {card.description ? (
                <p className="mt-1 text-sm leading-relaxed text-muted">{card.description}</p>
              ) : null}
              {card.preparationTip ? (
                <p className="mt-1 text-sm leading-relaxed text-muted">{card.preparationTip}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * **Photos divers brought back from the places this day dives.**
 *
 * `dive_site_moments` rows are diver photos a staffer chose to publish — the
 * schema calls them "staff-moderated, opt-in moments from prior divers" — and
 * from slice 7c (which deleted the briefing deck they lived in) until now the
 * page fetched them into every briefing and rendered none: the one place the
 * product holds real pictures of the actual reef, invisible on the page whose
 * whole job is "is this my Saturday?".
 *
 * One strip for the day, deduplicated by site, capped at four: ambience, not a
 * gallery. The caption is the diver's own line and does the talking, so the
 * photo itself is `alt=""` — reading the caption twice per photo is the only
 * thing a screen reader could add. Renders nothing when no site has a
 * published moment with a photo, which is most shops.
 */
/** The day's published diver photos, one strip, deduplicated by site and capped at four. */
export function dayMomentsFor(briefings: readonly SiteBriefing[]) {
  const seen = new Set<string>();
  const moments: { id: string; caption: string; imageUrl: string }[] = [];
  for (const { diveSite, moments: siteMoments } of briefings) {
    if (!diveSite || seen.has(diveSite.id)) continue;
    seen.add(diveSite.id);
    for (const moment of siteMoments) {
      if (moment.imageUrl) {
        moments.push({ id: moment.id, caption: moment.caption, imageUrl: moment.imageUrl });
      }
    }
  }
  return moments.slice(0, 4);
}

export function TripMoments({ briefings, locale }: { briefings: SiteBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const shown = dayMomentsFor(briefings);
  if (shown.length === 0) return null;
  return (
    <section className="mt-6">
      <GroupLabel as="h2">{t("trip.momentsHeading")}</GroupLabel>
      <ul className={`mt-3 grid gap-4${shown.length > 1 ? " sm:grid-cols-2" : ""}`}>
        {shown.map((moment) => (
          <li key={moment.id}>
            <figure>
              <StoredPhoto
                src={moment.imageUrl}
                alt=""
                className="aspect-[3/2] w-full rounded-inset"
                // Tracks the grid above it, which is only two-column when
                // there is more than one moment. Declared flat at `17rem` it
                // was right for a pair and half the truth for a single
                // moment, which fills the row: measured at 528px on a 768px
                // viewport against a 272px declaration, so the browser fetched
                // a candidate for a slot half the size and the diver got a
                // visibly soft photo. Nothing could see it — the visual suite
                // builds with `images.unoptimized`, so there is no srcset for
                // `sizes` to select from (issue #1350).
                sizes={
                  shown.length > 1
                    ? "(min-width: 640px) 17rem, 100vw"
                    : "(min-width: 640px) 33rem, 100vw"
                }
              />
              <figcaption className="mt-2 text-sm text-muted">{moment.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The routes the shop drew, for the sites this day dives.
 *
 * ADR 20260809-shop-drawn-dive-routes rests on one sentence — a route reaches
 * the diver, which is the only reason to draw one — and slice 7c broke it by
 * accident: the figure lived inside the swipeable briefing deck, so deleting
 * the deck left the staff route editor drawing for nobody. It comes back here
 * rather than in the deck, as **one figure per site** instead of one card per
 * tank. A two-tank day on one mooring drew the same line twice.
 *
 * Renders nothing at all when no site on the day has a route, which is the
 * ordinary case: most shops never draw one, and a heading over an empty frame
 * would be the page apologising for a feature the shop declined to use.
 */
/** The day's sites the shop actually drew a route for, once each. */
export function routeSitesFor(briefings: readonly SiteBriefing[]) {
  const seen = new Set<string>();
  const sites = [];
  for (const { diveSite } of briefings) {
    if (!diveSite || seen.has(diveSite.id) || !canDrawRoute(diveSite)) continue;
    seen.add(diveSite.id);
    sites.push(diveSite);
  }
  return sites;
}

export function TripRoutes({ briefings, locale }: { briefings: SiteBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const sites = routeSitesFor(briefings);
  if (sites.length === 0) return null;
  return (
    <section className="mt-6">
      <GroupLabel as="h2">{t("trip.theRoute", { count: sites.length })}</GroupLabel>
      <div className="mt-2 space-y-3">
        {sites.map((site) => (
          <DiveSiteMap key={site.id} site={site} t={t} />
        ))}
      </div>
    </section>
  );
}

/**
 * `siteFit` returns a tone, not prose (`src/lib/diver-planning.ts`) — this map
 * is where that tone becomes a word in the reader's own language. Spelled out
 * rather than built with a template literal so every key stays statically
 * visible to the message-key type checking.
 *
 * No `unknown` row, and no canned detail sentences any more: "Ask the crew
 * about fit" was a label apologising for data nobody entered, and each tone's
 * standing explainer ("The published depth and water movement make this an
 * approachable crew-led day.") restated the label it sat under on every site of
 * every trip page — the exact caption-restating-its-heading class the
 * copy-restraint rule deletes. The tone word states the fit; the shop's own
 * `fit_note` elaborates when the shop wrote one.
 */
const fitLabelKey = {
  demanding: "trip.siteFitDemandingLabel",
  welcoming: "trip.siteFitWelcomingLabel",
} as const;
const landmarkKindKey = {
  navigationMark: "site.landmarkKinds.navigationMark",
  reefHistory: "site.landmarkKinds.reefHistory",
  wreckFeature: "site.landmarkKinds.wreckFeature",
  underwaterMonument: "site.landmarkKinds.underwaterMonument",
  reefFormation: "site.landmarkKinds.reefFormation",
  pointOfInterest: "site.landmarkKinds.pointOfInterest",
} as const satisfies Record<DiveSiteLandmarkKind, string>;

/** One paragraph of the shop's own prose — no caption over it; the prose speaks. */
function SitePassage({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>;
}

/**
 * The day's sites that have something written about them, once each, with the
 * landmarks parsed and the two free-text marine-life fields already resolved
 * against the picked species. An empty list is a day the shop wrote nothing
 * about, and the beat renders nothing at all.
 */
export function siteNotePassagesFor(briefings: readonly SiteBriefing[]) {
  const seen = new Set<string>();
  const sites = [];
  for (const { diveSite, creatures } of briefings) {
    if (!diveSite || seen.has(diveSite.id)) continue;
    seen.add(diveSite.id);
    const landmarks = parseDiveSiteLandmarks(diveSite.landmarks);
    // The species the shop *picked* are already the "Look for" beat above, so
    // its two free-text twins — the shop's own paragraph ("Underwater
    // briefing") and its short list ("What might divers see?") — speak only for
    // a site that named none. Otherwise the page answers the same question
    // twice, in two voices.
    const lookFor =
      creatures.length > 0
        ? { summary: null, highlights: null }
        : { summary: diveSite.marineLifeDescription, highlights: diveSite.marineLife };
    const written =
      diveSite.fitNote ||
      diveSite.divePlan ||
      diveSite.currentNote ||
      diveSite.conservationNote ||
      lookFor.summary ||
      lookFor.highlights ||
      landmarks.length > 0;
    if (!written) continue;
    sites.push({ site: diveSite, landmarks, lookFor });
  }
  return sites;
}

/**
 * **What the shop wrote about the places this day dives.**
 *
 * ADR 20260813-dive-site-briefings-are-the-shops-own-words turns on one
 * sentence — *every sentence a diver reads on a briefing comes off the shop's
 * own row, and the staff form can write all of them* — and slice 7c broke it
 * the same way it broke the drawn route above: the prose lived inside the
 * swipeable briefing deck, so deleting the deck left eight authored columns
 * (`fit_tone`, `fit_note`, `dive_plan`, `current_note`, `marine_life`,
 * `marine_life_description`, `landmarks`, `conservation_note`) reaching no
 * diver at all, on a form that still asks for every one of them and 34 site
 * templates that still ship them.
 *
 * It comes back as one ledger beat rather than the deck: no comparison table,
 * no `text-2xl` heading competing with the page's own `h1` — the shop's prose
 * as plain passages under one site line, once per site rather than once per
 * tank, since a two-tank day on one mooring said all of this twice. The
 * passages carry no captions: "How the dive unfolds" over a sentence that
 * begins "Follow the coral ridge…" doubled every site's line count to caption
 * what the prose was about to say (the 2026-08-28 diver-views design review).
 *
 * Renders nothing when no site on the day has anything written. Most shops
 * fill in a name and a depth range and stop, and a heading over one canned
 * sentence would be the page talking to fill the space.
 */
export function TripSiteNotes({
  briefings,
  locale,
}: {
  briefings: SiteBriefing[];
  locale: string;
}) {
  const t = diverTranslator(locale);
  const sites = siteNotePassagesFor(briefings);
  if (sites.length === 0) return null;
  return (
    <section className="mt-6">
      <GroupLabel as="h2">{t("trip.theSite", { count: sites.length })}</GroupLabel>
      <div className="mt-2 divide-y divide-border">
        {sites.map(({ site, landmarks, lookFor }) => {
          const fit = siteFit(site);
          const fitWord = fit.tone === "unknown" ? null : t(fitLabelKey[fit.tone]);
          return (
            <div key={site.id} className="py-4 first:pt-0 last:pb-0">
              {/* One heading line: the site (only when the day dives more than
                  one — on a single-mooring day "The day" above has already said
                  it) and its fit word, together rather than as two stacked
                  labels. The word states the fit; everything under it is the
                  shop's own prose, uncaptioned, because "How the dive unfolds"
                  over a sentence that begins "Follow the coral ridge…" was the
                  caption restating what its paragraph was about to say — twice
                  per label, once per site, on every trip page. */}
              {sites.length > 1 || fitWord ? (
                <p className="text-sm">
                  {sites.length > 1 ? <span className="font-semibold">{site.name}</span> : null}
                  {sites.length > 1 && fitWord ? (
                    <span className="text-muted" aria-hidden="true">
                      {" · "}
                    </span>
                  ) : null}
                  {fitWord ? <span className="font-medium">{fitWord}</span> : null}
                </p>
              ) : null}
              {site.fitNote ? <SitePassage>{site.fitNote}</SitePassage> : null}
              {site.divePlan ? <SitePassage>{site.divePlan}</SitePassage> : null}
              {site.currentNote ? <SitePassage>{site.currentNote}</SitePassage> : null}
              {lookFor.summary ? <SitePassage>{lookFor.summary}</SitePassage> : null}
              {lookFor.highlights ? <SitePassage>{lookFor.highlights}</SitePassage> : null}
              {landmarks.length > 0 ? (
                <div className="mt-3">
                  <p className="text-sm font-medium">{t("trip.siteLandmarksHeading")}</p>
                  {/* More air than the passages get: the label is followed by
                      another `font-medium` line — a landmark's own name — and
                      without the gap the two read as one run-on sentence. */}
                  <ul className="mt-2 space-y-3">
                    {landmarks.map((landmark) => (
                      <li key={landmark.name} className="text-sm">
                        <span className="font-medium">{landmark.name}</span>
                        <span className="text-muted"> · {t(landmarkKindKey[landmark.kind])}</span>
                        {landmark.note ? (
                          <span className="mt-0.5 block leading-relaxed text-muted">
                            {landmark.note}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {site.conservationNote ? (
                <div className="mt-3">
                  <p className="text-sm font-medium">{t("trip.siteConservationHeading")}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{site.conservationNote}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
