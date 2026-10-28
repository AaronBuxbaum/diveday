import { Fragment } from "react";
import { canDrawRoute, DiveSiteMap } from "@/components/DiveSiteMap";
import { StoredPhoto } from "@/components/StoredPhoto";
import { GroupLabel } from "@/components/ui/group-label";
import {
  LedgerRow,
  ledgerKindColumnClass,
  ledgerRowBoxClass,
  ledgerRowOpenBoxClass,
} from "@/components/ui/ledger";
import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import type { SiteReview } from "@/db/reviews";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { courseDepthFormat, diveSiteDepthText } from "@/i18n/unit-labels";
import { type CourseScheduleDay, formatScheduleDayTime, resolveCourseDepths } from "@/lib/courses";
import { dayProfileRows } from "@/lib/day-profile";
import type { DepthUnit } from "@/lib/depth-units";
import { type DiveSiteLandmarkKind, parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { type DiveMode, type DockDayRhythm, dockDayTimeline, siteFit } from "@/lib/diver-planning";
import { formatShortDate, formatTime } from "@/lib/format";
import { capturePhoto } from "@/lib/marine-life-tiles";
import { publicDiveSitePath } from "@/lib/public-routes";
import type { SiteSightings } from "@/lib/sightings";
import type { DiveBriefing, Shop, SiteBriefing, Trip } from "./types";

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
  /**
   * The one boat day this departure is, for the rhythm line (fifth-loop
   * ideas, item 19): "At the dock 6:30 AM · back about 10:30 AM". Absent on a
   * course session or a departure that meets on more than one day, whose
   * days the line could not say in one breath.
   */
  day?: { startsAt: Date; endsAt: Date; plannedDives: number };
  /** The reader's depth unit, added after the shop's when it differs (ideas item 22). */
  readerDepthUnit?: DepthUnit | null;
  /** A course session's course: its own day list and whether its gear comes with it. */
  course?: CourseFacts | null;
};

type CourseFacts = { scheduleDays: CourseScheduleDay[]; gearIncluded: boolean };

type ProfileShop = Pick<Shop, keyof DockDayRhythm | "depthUnit">;
type ProfileTrip = Pick<Trip, "diveMode" | "course" | "startsAt" | "endsAt" | "plannedDives">;

/**
 * The facts "The day" reads off the shop and the departure. The day's two
 * ends ride along only for a one-day boat (fifth-loop ideas, item 19): a
 * course says its own day, and a departure meeting on several days could not
 * say them in one breath.
 */
export function dayProfileFacts(
  shop: ProfileShop,
  trip: ProfileTrip,
  dayCount: number,
  readerDepthUnit: DepthUnit | null,
): DayProfileFacts {
  return {
    rhythm: shop,
    depthUnit: shop.depthUnit,
    diveMode: trip.diveMode,
    dayCount,
    readerDepthUnit,
    course: trip.course,
    day:
      trip.course || dayCount > 1
        ? undefined
        : { startsAt: trip.startsAt, endsAt: trip.endsAt, plannedDives: trip.plannedDives },
  };
}

/**
 * What a course session's "The day" says of the course itself (UX sheet
 * 2026-10-22, item 3): the course's own day list, the "Your afternoon" its
 * page shows, and whether its gear comes with it. Read off the course row the
 * shop edits, never written again here, with its depth markers said in the
 * shop's unit as the course page says them.
 *
 * **One session, one day.** A trip page is one session, so it says that
 * session's day of the plan and never the whole multi-day plan. A session
 * records no plan day of its own (`trip_schedule_days` numbers its meetings,
 * not the course's days), so the only day it can be matched to is a
 * one-meeting session of a one-day plan: Discover Scuba's afternoon. Any other
 * session says no plan day at all; the gear line is the course's either way.
 */
export type CourseDayPlan = { days: CourseScheduleDay[]; gearIncluded: boolean };

export function courseDayPlan(
  course: CourseFacts | null | undefined,
  t: DiverTranslator,
  depthUnit: DepthUnit,
  meetingDays: number,
): CourseDayPlan | undefined {
  if (!course) return undefined;
  const sessionDays =
    meetingDays === 1 && course.scheduleDays.length === 1 ? course.scheduleDays : [];
  if (sessionDays.length === 0 && !course.gearIncluded) return undefined;
  const format = courseDepthFormat(t, depthUnit);
  return {
    days: sessionDays.map((day) => ({
      ...day,
      title: resolveCourseDepths(day.title, format),
      items: day.items.map((item) => resolveCourseDepths(item, format)),
    })),
    gearIncluded: course.gearIncluded,
  };
}

function CoursePlan({
  plan,
  t,
  locale,
}: {
  plan: CourseDayPlan;
  t: DiverTranslator;
  locale: string;
}) {
  return (
    <div data-testid="trip-course-plan" className="mt-2 space-y-3">
      {plan.days.map((day) => {
        const time = formatScheduleDayTime(day, locale);
        return (
          <div key={day.title}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium">
              <span>{day.title}</span>
              {time ? <span className="font-normal text-muted tabular-nums">{time}</span> : null}
            </p>
            {day.items.length > 0 ? (
              <ul className="mt-1 grid gap-1 text-sm text-muted">
                {day.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {plan.gearIncluded ? <p className="text-sm">{t("trip.courseGearIncluded")}</p> : null}
    </div>
  );
}

/**
 * "At the dock 6:30 AM · back about 10:30 AM": the first and last beats of the
 * same `dockDayTimeline` `/ready`'s "Your dock-day rhythm" lays out, so the
 * page a first boat diver reads before paying and the page they keep after
 * agree to the minute. The return is the departure's own published end, never
 * the shop's arithmetic.
 */
export function dayRhythmLine(
  facts: DayProfileFacts,
  briefings: readonly DiveBriefing[],
  t: DiverTranslator,
  locale: string,
  timeZone: string,
): string | null {
  const day = facts.day;
  if (!day) return null;
  const beats = dockDayTimeline(
    day.startsAt,
    facts.rhythm,
    day.endsAt,
    day.plannedDives,
    briefings.map(({ diveSite }) => diveSite?.expectedBottomTimeMinutes),
    briefings.map(({ dive }) => dive.travelMinutes),
    facts.diveMode,
  );
  const first = beats[0];
  const back = beats.find((beat) => beat.step === "return");
  if (!first || !back) return null;
  // A shore or pool day has no dock: the first beat is where the group meets.
  return t(facts.diveMode === "boat" ? "trip.dayRhythmLine" : "trip.dayRhythmMeetLine", {
    dock: formatTime(first.at, locale, timeZone),
    back: formatTime(back.at, locale, timeZone),
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
 * **It is a record, and it says so.** "Seen" is past tense on purpose and every
 * line is a frequency rather than an expectation — because a page that prints
 * "turtles on 14 of the last 16 dives" without saying so is one glance away
 * from being read as a promise, and the crew who wrote those rows would be the
 * ones asked about it on the boat. The heading and the lines carry that
 * boundary by themselves: "Seen here this month", every count "of N logged
 * dives", every date "Last seen". A sentence under the plan used to say it
 * again ("It says what was seen, not what you will see") and was cut as a
 * disclaimer the diver never asked for (UX review 2026-10-10, item 22).
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
            {/* The heading already says "this month"; the exact day is a
                desktop's second line, and on a phone it doubled the list. */}
            <span className="block text-muted max-sm:hidden">{line.lastSeen}</span>
          </li>
        ))}
      </ul>
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
 * The dives stay time-neutral — a dive plan's clock belongs to the day itself
 * (`PackingSection`'s dock-day rhythm on the thread), and a schedule of
 * tanks printed beside a Book button reads as a commitment the crew has not
 * made. The day's two ends are the exception (fifth-loop ideas, item 19): when
 * to be at the dock and when the boat is due back are the shop's published
 * promise, and a first boat diver deciding whether the morning fits needs
 * them before paying, in one line.
 */
export function TripDayPlan({
  briefings,
  shop,
  locale,
  profile,
  sightings,
  nextOpensOnRule = false,
  siteReviews,
  content = "full",
}: {
  briefings: DiveBriefing[];
  /**
   * The shop, for its zone and for its own slug, which is half of every site
   * page's URL.
   */
  shop: Pick<Shop, "slug" | "timezone" | "name" | "depthUnit">;
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
  /**
   * Whether the block under this section opens on a rule of its own — the
   * public trip's pitch when it opens on its door (`pitchOpensOnDoor`). The
   * run then leaves its close to that rule.
   */
  nextOpensOnRule?: boolean;
  /**
   * Published reviews from departures to the day's sites (`listSiteReviews`),
   * at most two. Absent or empty renders nothing.
   */
  siteReviews?: readonly SiteReview[];
  /** Keep the public itinerary compact; its site reports follow booking. Embeds retain the full plan. */
  content?: "full" | "itinerary" | "reports";
}) {
  const t = diverTranslator(locale);
  const course = profile
    ? courseDayPlan(profile.course, t, profile.depthUnit, profile.dayCount)
    : undefined;
  if (briefings.length === 0 && !course) return null;
  const rhythm = profile ? dayRhythmLine(profile, briefings, t, locale, shop.timezone) : null;
  const rhythmLine = rhythm ? (
    <p data-testid="trip-day-rhythm" className="mt-2 text-sm font-medium">
      {rhythm}
    </p>
  ) : null;
  const coursePlan = course ? <CoursePlan plan={course} t={t} locale={locale} /> : null;
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
  // One beat per *site*, not per tank: a two-tank day on one mooring would
  // otherwise print the same month twice, the way the route and the site prose
  // used to before they were deduplicated.
  //
  // Resolved before the render rather than by mutating a `Set` inside the map,
  // because the caption below the list has to know whether any of these beats
  // rendered at all, and a set filled during JSX evaluation is a fact the code
  // after `</ul>` can only read by accident of argument order.
  const seenShown = new Set<string>();
  const seenByDive = new Map<string, SiteSightings>();
  for (const { dive, diveSite } of briefings) {
    if (!diveSite || seenShown.has(diveSite.id)) continue;
    const found = sightings?.get(diveSite.id);
    if (!found) continue;
    seenShown.add(diveSite.id);
    seenByDive.set(dive.id, found);
  }
  // A day where nothing is decided yet says so once. Two rows both reading
  // "Site to be confirmed" opened the sparse course session's pitch with the
  // one thing the shop has not decided, stated twice (principle 9; 2026-08-28
  // diver-views review, finding 10). The count survives — it is the one fact
  // those rows carried.
  if (briefings.every(({ dive, diveSite }) => !dive.title && !diveSite)) {
    if (content === "reports") return null;
    return (
      <section>
        <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
        {rhythmLine}
        {coursePlan}
        {briefings.length > 0 ? (
          <p className="mt-2 text-sm text-muted">
            {t("trip.sitesToBeConfirmed", { count: briefings.length })}
          </p>
        ) : null}
      </section>
    );
  }
  // **The run closes itself unless a rule follows it directly** (pixel-craft
  // class 6). With a pitch opening on its door, the run's closing rule sat
  // 32px over the door's own, two parallel hairlines with nothing between
  // them. Anywhere else the rule is the list's only close: over the site
  // reviews, or over a pitch that opens on its fit word and faces, leaving it
  // open left the last dive unclosed above body text. Every line, hand-set or
  // not, takes one box.
  const reviews = siteReviews ?? [];
  const reviewBlock =
    content === "itinerary" ? null : reviews.length > 0 ? (
      <div data-testid="trip-site-reviews" className="mt-6">
        <p className="text-sm font-medium">{t("trip.siteReviews.heading")}</p>
        <ul className="mt-2 space-y-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <figure>
                <blockquote className="line-clamp-4 text-sm leading-relaxed text-pretty">
                  {t("trip.siteReviews.quote", { words: review.comment })}
                </blockquote>
                <figcaption className="mt-1 text-sm text-muted">
                  {t("trip.siteReviews.byline", {
                    name: review.reviewer,
                    date: formatShortDate(review.divedAt, locale, shop.timezone),
                  })}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  if (content === "reports") {
    if (seenByDive.size === 0 && !reviewBlock) return null;
    return (
      <div className="space-y-6">
        {briefings.map(({ dive, diveSite }) => {
          const seen = seenByDive.get(dive.id);
          return seen ? (
            <div key={dive.id}>
              <p className="mb-2 text-sm font-medium">{diveSite?.name}</p>
              <SiteSeen seen={seen} t={t} locale={locale} timeZone={shop.timezone} />
            </div>
          ) : null;
        })}
        {reviewBlock}
      </div>
    );
  }
  const runCloses = !nextOpensOnRule || reviewBlock !== null;
  const handSetBox = runCloses ? ledgerRowBoxClass : ledgerRowOpenBoxClass;
  return (
    <section>
      <GroupLabel as="h2">{t("trip.theDay")}</GroupLabel>
      {rhythmLine}
      {coursePlan}
      <ul className="mt-2">
        {briefings.map(({ dive, diveSite }) => {
          const bottomTime = bottomTimes.get(dive.diveNumber) ?? null;
          const interval = intervals.get(dive.diveNumber) ?? null;
          // The recorded range in the shop's unit ("18–40 m"), or just the site's
          // maximum; the shop's own note stands in only where no depth is recorded.
          // The crew's month for this site, once — decided above, in plan order.
          const seen = content === "itinerary" ? null : (seenByDive.get(dive.id) ?? null);
          const depth = diveSite
            ? diveSiteDepthText(t, diveSite, shop.depthUnit, profile?.readerDepthUnit ?? null)
            : null;
          // **The site's name is the door to its own page** (N-48). The whole
          // of what the shop wrote about a place — the prose, the drawn route,
          // the field guide, the diver photos, and every other departure going
          // there — lives at `/s/<shop>/sites/<site>`, and this run of rows is
          // the one beat on this page that names every site the day dives. A
          // page reachable only from a sitemap is a page divers never find.
          //
          // **The row is the door** (pixel-craft class 7, K-168), whichever of
          // its lines names the site. The name was an inline link inside a
          // plain row, a 17px-tall target ("French Reef" 79×17 at 390) with
          // its ring hugging the words; a door row is the whole row, 52px and
          // up, with the chevron that says it opens. A dive with no site yet
          // has nowhere to go and stays a plain row.
          const siteDoor = diveSite
            ? { href: publicDiveSitePath(shop.slug, diveSite.slug), linkLabel: diveSite.name }
            : {};
          const lead = dive.title ?? diveSite?.name ?? t("trip.siteToBeConfirmed");
          return (
            <Fragment key={dive.id}>
              <LedgerRow
                closed={runCloses}
                kind={{ word: t("trip.diveNumber", { number: dive.diveNumber }), tone: "neutral" }}
                trailing={
                  depth ? <span className="text-sm text-muted tabular-nums">{depth}</span> : null
                }
                {...siteDoor}
              >
                <span className="block text-sm font-medium">{lead}</span>
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
                  shape for the same reason. It takes the dive rows' box, so its
                  rules are theirs. */}
              {seen ? (
                <li className={`flex gap-3 py-2 ${handSetBox}`}>
                  <span className={`${ledgerKindColumnClass} shrink-0`} />
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
                <li className={`flex items-center gap-3 py-2 ${handSetBox}`}>
                  <span className={`${ledgerKindColumnClass} shrink-0`} />
                  <span className="text-sm text-muted tabular-nums">
                    {t("trip.dayProfile.surfaceInterval", { minutes: interval })}
                  </span>
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ul>
      {/* What earlier divers said about these sites, under the plan they
          are about (fifth-loop ideas, item 20). Their words, quoted, with a
          name and the day they went; no stars, which the shop's own reviews
          page already carries. */}
      {reviewBlock}
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
      {/* `mt-2`, as every beat opens under its label (pixel-craft class 4,
          K-509): at `mt-3` this one floated 12px above its faces. */}
      <GroupLabel as="h2">{t("trip.lookFor")}</GroupLabel>
      <ul className="mt-2 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.slug ?? card.name} className="flex min-w-0 gap-3">
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
 * **The day's cover photo**: the first photo the shop uploaded for the first
 * of the day's sites that has one. A departure has no photo of its own, and it
 * needs none — the shop already photographs the places it goes, on the site
 * form, and a departure page with no picture on it was selling a reef in
 * words alone. Null when no site on the day has a photo.
 */
export function dayCoverPhoto(briefings: readonly SiteBriefing[]): string | null {
  for (const { diveSite } of briefings) {
    const first = diveSite?.imageUrls?.[0];
    if (first) return first;
  }
  return null;
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
                <div className="mt-3">
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
                        ? "mt-2 grid gap-x-4 gap-y-5 sm:grid-cols-2"
                        : "mt-2 space-y-3"
                    }
                  >
                    {landmarks.map((landmark) => (
                      <li key={landmark.name} className="min-w-0 text-sm">
                        {landmark.photoUrl ? (
                          <StoredPhoto
                            src={landmark.photoUrl}
                            alt=""
                            className="mb-2 aspect-[3/2] w-full rounded-inset"
                            sizes="(min-width: 896px) 26rem, (min-width: 640px) 46vw, 92vw"
                          />
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
