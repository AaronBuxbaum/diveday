import { canDrawRoute, DiveSiteMap } from "@/components/DiveSiteMap";
import { StoredPhoto } from "@/components/StoredPhoto";
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
  // A day where nothing is decided yet says so once. Two rows both reading
  // "Site to be confirmed" opened the sparse course session's pitch with the
  // one thing the shop has not decided, stated twice (principle 9; 2026-08-28
  // diver-views review, finding 10). The count survives — it is the one fact
  // those rows carried.
  if (briefings.every(({ dive, diveSite }) => !dive.title && !diveSite)) {
    return (
      <section className="mt-8">
        <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
        <p className="mt-2 text-sm text-muted">
          {t("trip.sitesToBeConfirmed", { count: briefings.length })}
        </p>
      </section>
    );
  }
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
export function TripLookFor({ briefings, locale }: { briefings: DiveBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
  const seen = new Set<string>();
  const cards = briefings.flatMap(({ creatures }) =>
    creatures.filter((creature) => {
      const key = creature.slug ?? creature.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
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
export function TripMoments({ briefings, locale }: { briefings: DiveBriefing[]; locale: string }) {
  const t = diverTranslator(locale);
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
  const shown = moments.slice(0, 4);
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
