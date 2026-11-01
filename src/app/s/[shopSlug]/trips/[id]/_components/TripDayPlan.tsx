import { Fragment } from "react";
import type { SiteBriefing } from "@/components/SiteBriefing";
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
import { type DiveMode, type DockDayRhythm, dockDayTimeline } from "@/lib/diver-planning";
import { formatShortDate, formatTime } from "@/lib/format";
import { publicDiveSitePath } from "@/lib/public-routes";
import type { SiteSightings } from "@/lib/sightings";
import type { DiveBriefing, Shop, Trip } from "./types";

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
 * off `/ready` too and deleted it (H-20260815-no-legacy), so these two beats are the whole of
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
