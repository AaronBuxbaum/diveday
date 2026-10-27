import {
  crewBelowTargetDetailText,
  instructorMissingDetailText,
  openCrewActionText,
  overRatioDetailText,
  overRatioIntroDetailText,
  ratingLapsedDetailText,
  ratingUnverifiedDetailText,
  uncrewedCourseDetailText,
  uncrewedDepartureDetailText,
} from "@/i18n/today-labels";
import type { InWaterCrewCount } from "@/lib/crew-roles";
import { DEFAULT_DIVERS_PER_DIVEMASTER } from "@/lib/divemaster-ratio";
import { crewGapFor } from "@/lib/staffing-week";
import { type TodayAction, urgencyFor } from "@/lib/today";
import { NO_SUPERVISION } from "./course-crew-counts";
import type { TodayRowsContext } from "./today-rows-context";

type WindowTrip = TodayRowsContext["inWindow"][number];

/**
 * A departure's crew rows: `uncrewed_departure`, `course_crew_gap` and
 * `crew_below_target`, off the one "course crew gap" computation the trip page
 * and the staffing list read too, with a lapse named when it is what opened
 * the gap (issue #1853).
 */
export function pushCrewGapRows(
  actions: TodayAction[],
  ctx: TodayRowsContext,
  {
    trip,
    when,
    departure,
    tripHref,
  }: {
    trip: WindowTrip;
    when: string;
    departure: { tripId: string; label: string };
    tripHref: string;
  },
): void {
  const { t, now, locale, diversPerDivemaster } = ctx;
  const { courseCrewCounts } = ctx.wave;
  // **One decision, shared with the staffing week** (`crewGapFor`,
  // src/lib/staffing-week.ts; issue #2482): the agency training ratio, the
  // shop's own target, and which of them a departure's one row names. The
  // trip page and the staffing coverage list read the same course crew gap
  // (Lens 17 task 151), so a session Today flags as over its ratio can
  // neither read as "Covered" on staffing nor be filed there under "needs an
  // instructor" when it already has one. A departure the shop has marked
  // self-guided raises no row (issue #973).
  const counts = courseCrewCounts.get(trip.id) ?? NO_SUPERVISION;
  const decide = (claim: InWaterCrewCount) =>
    crewGapFor({
      course: trip.course,
      counts: claim,
      booked: trip.booked,
      bookedDivers: trip.bookedDivers,
      diversPerDivemaster,
      selfGuided: trip.selfGuided,
    });
  const gap = decide(counts);
  if (gap.code === null) return;
  const { courseGap: crewGap, ratioGap, uncrewed } = gap;
  // **A gap a lapse opened says so, and only that gap** (issue #1853).
  // `counts` reads each rostered professional's recorded ratings, so a crew
  // list with an instructor's name on it can still raise these rows. The
  // same decision is taken again on the roster's claim, and a row carries
  // the lapse only when the roster would not have raised it: a divemaster's
  // lapsed card beside a session nobody rostered an instructor on is not why
  // it has no instructor (dive-domain review). Never a refusal — the booking
  // gate still reads the roster's claim (H-59).
  const roster = decide(counts.roster);
  const rosterCrewGap = roster.courseGap;
  const rosterRatioGap = roster.ratioGap;
  const rosterUncrewed = roster.uncrewed;
  const lapseNote =
    [
      counts.lapsed.length > 0 ? ratingLapsedDetailText(t, locale, counts.lapsed) : null,
      counts.unverified?.length ? ratingUnverifiedDetailText(t, locale, counts.unverified) : null,
    ]
      .filter(Boolean)
      .join(" ") || null;
  const explainedIf = (opened: boolean, detail: string) =>
    opened && lapseNote ? `${detail} ${lapseNote}` : detail;
  // Who lost the instructor rung — the only people who can be why a session
  // reads as having no instructor.
  const lostInstructor = counts.lapsed.filter((member) => member.lost === "instructor");
  const unverifiedInstructor = (counts.unverified ?? []).filter(
    (member) => member.lost === "instructor",
  );
  if (crewGap.code !== "none" && !uncrewed) {
    const opened = rosterCrewGap.code !== crewGap.code || rosterUncrewed;
    actions.push({
      id: `instructor:${trip.id}`,
      kind: "instructor_missing",
      urgency: urgencyFor(trip.startsAt, now),
      subject: trip.title,
      context: when,
      departure,
      aboutDeparture: true,
      detail:
        crewGap.code === "over_ratio"
          ? // An intro session's cap is PADI's Discover Scuba open-water
            // figure (2 per instructor, HD-6) and an assistant does not raise
            // it, so the entry-level wording — which cites the Open Water
            // 8-plus-2 and tells staff to add an assistant — would both
            // misquote a standard and prescribe a fix that changes nothing.
            // Each rule gets its own sentence.
            explainedIf(
              opened,
              crewGap.ratio === "intro"
                ? overRatioIntroDetailText(t, crewGap.booked, crewGap.capacity)
                : overRatioDetailText(t, crewGap.booked, crewGap.capacity),
            )
          : // "No instructor assigned" is false beside a lapsed instructor's
            // name, so when one lost the rung the lapse is the whole
            // sentence. When nobody did, the session has no instructor
            // rostered at all, and that is what it says.
            opened && lostInstructor.length > 0
            ? ratingLapsedDetailText(t, locale, lostInstructor)
            : opened && unverifiedInstructor.length > 0
              ? ratingUnverifiedDetailText(t, locale, unverifiedInstructor)
              : instructorMissingDetailText(t),
      actionLabel: openCrewActionText(t),
      // The trip's crew editor, not the bare Overview it used to land on
      // (Lens 17 task 139) — the fix for either gap lives right there.
      href: `${tripHref}?view=details#crew`,
      dueAt: trip.startsAt,
    });
  }

  // The shop's own target (`divemasterRatioGap`, src/lib/divemaster-ratio.ts)
  // — every dive the shop runs, course session or fun dive alike, unlike
  // `courseCrewGap` above, which is an agency-published training ratio and
  // only ever fires for a course (issue #732). It reuses `counts`: the same
  // crew count `courseCrewGap` read, never a second query or a second
  // definition of who is in the water (`countInWaterCrew`,
  // src/lib/crew-roles.ts). Binds nothing — informs only, as on the trip page.
  //
  // Still one row per departure. The below-target row is suppressed when the
  // instructor gap was placed above, because that gap is the more precise
  // statement of the same shortfall and firing both would name one fact in
  // two vocabularies (the wallpaper failure DOM-H3 designs against). The
  // zero-crew row is not suppressed — it *replaced* the instructor row
  // rather than joining it. `courseCrewGap` returns `"none"` for every fun
  // dive by construction, so a fun dive reaches both rows exactly as before.
  if (ratioGap.code === "under_target" && (uncrewed || crewGap.code === "none")) {
    // Two different sentences for two different problems, not one branching
    // on count: "nobody is rostered at all" and "one short of your target"
    // read as different severities because they are. The zero-crew case
    // gets its own kind and rank, above `nitrox_gate`; the below-target
    // case gets a quieter one, ranked with the other purely-advisory rows
    // (`KIND_SEVERITY`, src/lib/today.ts).
    if (ratioGap.divemasterCount === 0) {
      // Which of the two zero-crew rows is the course/fun-dive split, read
      // off `crewGap` rather than off `trip.course` so the two cannot
      // disagree: with nobody in the water `instructorCount` is 0, so
      // `courseCrewGap` returns `no_instructor` for exactly the sessions
      // that have a course attached. The course row says both words —
      // "No crew" alone would send a manager looking for any divemaster,
      // and only an instructor closes a course gap.
      const course = crewGap.code === "no_instructor";
      actions.push({
        id: `uncrewed:${trip.id}`,
        kind: course ? "uncrewed_course" : "uncrewed_departure",
        ...(!rosterUncrewed && counts.unverified?.length
          ? { kindLabelKey: "today.actionKind.crewRatingUnverified" as const }
          : {}),
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail:
          !rosterUncrewed && counts.unverified?.length && lapseNote
            ? lapseNote
            : explainedIf(
                !rosterUncrewed,
                course
                  ? uncrewedCourseDetailText(t, ratioGap.divers)
                  : uncrewedDepartureDetailText(t, ratioGap.divers),
              ),
        actionLabel: openCrewActionText(t),
        href: `${tripHref}?view=details#crew`,
        dueAt: trip.startsAt,
      });
    } else {
      actions.push({
        id: `crew-target:${trip.id}`,
        kind: "crew_below_target",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: explainedIf(
          rosterRatioGap.code === "none",
          crewBelowTargetDetailText(
            t,
            ratioGap.divers,
            ratioGap.divemasterCount,
            // Never null here: a null target reports no gap at all.
            diversPerDivemaster ?? DEFAULT_DIVERS_PER_DIVEMASTER,
          ),
        ),
        actionLabel: openCrewActionText(t),
        href: `${tripHref}?view=details#crew`,
        dueAt: trip.startsAt,
      });
    }
  }
}
