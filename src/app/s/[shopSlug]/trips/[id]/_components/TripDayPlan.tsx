import { Fragment } from "react";
import { canDrawRoute, DiveSiteMap } from "@/components/DiveSiteMap";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";
import { diverTranslator } from "@/i18n/messages";
import { type DiveSiteLandmarkKind, parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { siteFit } from "@/lib/diver-planning";
import type { DiveBriefing } from "./types";

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
  locale,
}: {
  briefings: DiveBriefing[];
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
}) {
  if (briefings.length === 0) return null;
  const t = diverTranslator(locale);
  return (
    <section className="mt-8">
      <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
      <ul className="mt-2">
        {briefings.map(({ dive, diveSite }) => (
          <LedgerRow
            key={dive.id}
            kind={{ word: t("trip.diveNumber", { number: dive.diveNumber }), tone: "neutral" }}
            trailing={
              diveSite?.depthRange ? (
                <span className="text-sm text-muted tabular-nums">{diveSite.depthRange}</span>
              ) : null
            }
          >
            <span className="block text-sm font-medium">
              {dive.title ?? diveSite?.name ?? t("trip.siteToBeConfirmed")}
            </span>
            {/* The site under the dive's own name, when the shop gave the dive
                a name of its own that is not simply the site's. A departure
                whose second tank has no site yet says so here rather than
                reading as a one-site day. */}
            {dive.title && diveSite?.name && dive.title !== diveSite.name ? (
              <span className="block text-sm text-muted">{diveSite.name}</span>
            ) : null}
            {dive.title && !diveSite ? (
              <span className="block text-sm text-muted">{t("trip.siteToBeConfirmed")}</span>
            ) : null}
          </LedgerRow>
        ))}
      </ul>
    </section>
  );
}

/**
 * The species the shop chose for this day's sites, as one line of names.
 *
 * DiveDay writes the words and the shop picks the faces (ADR
 * 20260813-marine-life-is-diveday-copy), so these arrive already resolved into
 * the reader's language by `fieldGuideCards`. Deduplicated by name because a
 * two-tank day on one mooring carries the same guide twice, and renders nothing
 * at all when no site names a species — an empty "Look for" is a heading
 * apologising for having nothing under it.
 */
export function TripLookFor({ briefings, locale }: { briefings: DiveBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const names = [
    ...new Set(briefings.flatMap(({ creatures }) => creatures.map((creature) => creature.name))),
  ];
  if (names.length === 0) return null;
  return (
    <section className="mt-6">
      <GroupLabel as="h2">{t("trip.lookFor")}</GroupLabel>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        {names.map((name, index) => (
          <Fragment key={name}>
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span>{name}</span>
          </Fragment>
        ))}
      </p>
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
export function TripRoutes({ briefings, locale }: { briefings: DiveBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const seen = new Set<string>();
  const sites = [];
  for (const { diveSite } of briefings) {
    if (!diveSite || seen.has(diveSite.id) || !canDrawRoute(diveSite)) continue;
    seen.add(diveSite.id);
    sites.push(diveSite);
  }
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
 * `siteFit` returns a tone, not prose (`src/lib/diver-planning.ts`) — these
 * maps are where that tone becomes a sentence in the reader's own language.
 * Spelled out rather than built with a template literal so every key stays
 * statically visible to the message-key type checking.
 */
const fitLabelKey = {
  demanding: "trip.siteFitDemandingLabel",
  welcoming: "trip.siteFitWelcomingLabel",
  unknown: "trip.siteFitUnknownLabel",
} as const;
const fitDetailKey = {
  demanding: "trip.siteFitDemandingDetail",
  welcoming: "trip.siteFitWelcomingDetail",
  unknown: "trip.siteFitUnknownDetail",
} as const;
const landmarkKindKey = {
  navigationMark: "site.landmarkKinds.navigationMark",
  reefHistory: "site.landmarkKinds.reefHistory",
  wreckFeature: "site.landmarkKinds.wreckFeature",
  underwaterMonument: "site.landmarkKinds.underwaterMonument",
  reefFormation: "site.landmarkKinds.reefFormation",
  pointOfInterest: "site.landmarkKinds.pointOfInterest",
} as const satisfies Record<DiveSiteLandmarkKind, string>;

/** One labelled paragraph of the shop's own prose. */
function SiteNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
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
 * It comes back as one ledger beat rather than the deck: no photo grid, no
 * comparison table, no `text-2xl` heading competing with the page's own `h1` —
 * the run of short labelled paragraphs a deciding diver reads, once per site
 * rather than once per tank, since a two-tank day on one mooring said all of
 * this twice.
 *
 * Renders nothing when no site on the day has anything written. Most shops
 * fill in a name and a depth range and stop, and a heading over one canned
 * sentence would be the page talking to fill the space.
 */
export function TripSiteNotes({
  briefings,
  locale,
}: {
  briefings: DiveBriefing[];
  locale: string;
}) {
  const t = diverTranslator(locale);
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
  if (sites.length === 0) return null;
  return (
    <section className="mt-6">
      <GroupLabel as="h2">{t("trip.theSite", { count: sites.length })}</GroupLabel>
      <div className="mt-2 divide-y divide-border">
        {sites.map(({ site, landmarks, lookFor }) => {
          const fit = siteFit(site);
          return (
            <div key={site.id} className="py-4 first:pt-0 last:pb-0">
              {/* The site names itself only when the day dives more than one —
                  on a single-mooring day "The day" above has already said it. */}
              {sites.length > 1 ? <p className="text-sm font-semibold">{site.name}</p> : null}
              <p className={`text-sm font-medium ${sites.length > 1 ? "mt-2" : ""}`}>
                {t(fitLabelKey[fit.tone])}
              </p>
              {/* The shop's own sentence about who this site suits, when it has
                  written one. DiveDay's canned line stands in only for a site
                  nobody has said anything about yet. */}
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {site.fitNote || t(fitDetailKey[fit.tone])}
              </p>
              {site.divePlan ? (
                <SiteNote label={t("trip.siteHowItUnfolds")}>{site.divePlan}</SiteNote>
              ) : null}
              {site.currentNote ? (
                <SiteNote label={t("trip.siteWaterMovement")}>{site.currentNote}</SiteNote>
              ) : null}
              {lookFor.summary || lookFor.highlights ? (
                <div className="mt-3">
                  <p className="text-sm font-medium">{t("trip.siteWhatToLookFor")}</p>
                  {lookFor.summary ? (
                    <p className="mt-1 text-sm leading-relaxed text-muted">{lookFor.summary}</p>
                  ) : null}
                  {lookFor.highlights ? (
                    <p className="mt-1 text-sm text-muted">{lookFor.highlights}</p>
                  ) : null}
                </div>
              ) : null}
              {landmarks.length > 0 ? (
                <div className="mt-3">
                  <p className="text-sm font-medium">{t("trip.siteLandmarksHeading")}</p>
                  <ul className="mt-1 space-y-2">
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
                <SiteNote label={t("trip.siteConservationHeading")}>
                  {site.conservationNote}
                </SiteNote>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
