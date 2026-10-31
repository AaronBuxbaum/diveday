import Image from "next/image";
import { canDrawRoute, DiveSiteMap } from "@/components/DiveSiteMap";
import { StoredPhoto } from "@/components/StoredPhoto";
import { GroupLabel } from "@/components/ui/group-label";
import type { getDiveSiteBySlug } from "@/db/dive-sites";
import type { MarineLifeCard } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { type DiveSiteLandmarkKind, parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { siteFit } from "@/lib/diver-planning";
import { capturePhoto } from "@/lib/marine-life-tiles";

/** The site and reader-language field guide shared by the public site and trip views. */
export type SiteBriefing = {
  diveSite: Awaited<ReturnType<typeof getDiveSiteBySlug>> | null;
  creatures: (MarineLifeCard & { id: string })[];
};

/**
 * The shop's chosen species for these sites, in plan order, deduplicated
 * because a two-tank day on one mooring carries the same guide twice.
 *
 * Exported so `TripPitch`'s three tiles and the full list below read the same
 * list in the same order.
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

/** The localized species cards, with the visible name as their accessible content. */
export function TripLookFor({ briefings, locale }: { briefings: SiteBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const cards = fieldGuideCardsFor(briefings);
  if (cards.length === 0) return null;
  return (
    <section className="mt-6">
      {/* `mt-2`, as every beat opens under its label (pixel-craft class 4,
          K-509): at `mt-3` this one floated 12px above its faces. */}
      <GroupLabel as="h2">{t("trip.lookFor")}</GroupLabel>
      <ul className="mt-2 grid gap-x-6 gap-y-5 sm:grid-cols-2 print:block">
        {cards.map((card) => (
          <li
            key={card.slug ?? card.name}
            className="flex min-w-0 gap-3 print:mb-4 print:me-[2%] print:inline-flex print:w-[48%] print:align-top"
          >
            <StoredPhoto
              // Capture-only rewrite; `src/lib/marine-life-tiles.ts`.
              src={capturePhoto(card.imageUrl, 48)}
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
          <DiveSiteMap key={site.id} site={site} t={t} printTextOnly />
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
      {/* The rules between passages are a ledger's length, as the door's own
          rule above them is: 8px past the column, with the words kept on it. */}
      <div className="-mx-2 mt-2 divide-y divide-border">
        {sites.map(({ site, landmarks, lookFor }) => {
          const fit = siteFit(site);
          const fitWord = fit.tone === "unknown" ? null : t(fitLabelKey[fit.tone]);
          return (
            <div key={site.id} className="px-2 py-4 first:pt-0 last:pb-0">
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
                <div className="mt-3 print:break-inside-avoid">
                  <p className="text-sm font-medium">{t("trip.siteLandmarksHeading")}</p>
                  {/* More air than the passages get: the label is followed by
                      another `font-medium` line — a landmark's own name — and
                      without the gap the two read as one run-on sentence. */}
                  {/* A landmark the shop photographed is shown, not only
                      named: the picture is what a diver will look for on the
                      bottom. With any photo the list becomes a two-up grid
                      on a wider screen, one column on a phone; without one
                      it stays the run of lines it was. The name under the
                      photo is the content, so the photo is `alt=""`. */}
                  <ul
                    className={
                      // Fewer than four is a list whatever the photos (visual
                      // review 2026-10-24, B50): three in a two-up grid left
                      // one large empty cell beside the last.
                      landmarks.length >= 4 && landmarks.some((landmark) => landmark.photoUrl)
                        ? "mt-2 grid gap-x-4 gap-y-5 sm:grid-cols-2 print:block"
                        : "mt-2 space-y-3"
                    }
                  >
                    {landmarks.map((landmark) => (
                      <li
                        key={landmark.name}
                        className="min-w-0 text-sm print:mb-4 print:me-[2%] print:inline-block print:w-[48%] print:align-top"
                      >
                        {landmark.photoUrl ? (
                          <>
                            <StoredPhoto
                              src={landmark.photoUrl}
                              alt=""
                              className="mb-2 aspect-[3/2] w-full rounded-inset print:hidden"
                              sizes="(min-width: 896px) 26rem, (min-width: 640px) 46vw, 92vw"
                            />
                            <Image
                              src={landmark.photoUrl}
                              alt=""
                              width={224}
                              height={150}
                              className="mb-2 hidden h-28 w-full object-contain print:block"
                            />
                          </>
                        ) : null}
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
