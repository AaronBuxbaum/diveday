import {
  crewBelowTargetDetailText,
  instructorMissingDetailText,
  openCrewActionText,
  overRatioDetailText,
  overRatioIntroDetailText,
  ratingLapsedDetailText,
  uncrewedCourseDetailText,
  uncrewedDepartureDetailText,
} from "@/i18n/today-labels";
import { courseCrewGap } from "@/lib/course-ratios";
import {
  DEFAULT_DIVERS_PER_DIVEMASTER,
  divemasterRatioGap,
  inWaterDivemasterCount,
} from "@/lib/divemaster-ratio";
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
  // The one "course crew gap" computation (Lens 17 task 151) — also
  // consumed by the trip page and the staffing coverage list, and all three
  // report its two codes separately, so a session Today flags as over its
  // ratio can neither read as "Covered" on staffing nor be filed there under
  // "needs an instructor" when it already has one.
  const counts = courseCrewCounts.get(trip.id) ?? NO_SUPERVISION;
  const crewGap = courseCrewGap({
    course: trip.course,
    instructorCount: counts.instructorCount,
    assistantCount: counts.assistantCount,
    booked: trip.booked,
  });
  // The shop's own divemaster target is resolved before either row is
  // pushed, because the zero-crew case outranks the instructor gap and needs
  // this answer to know whether it applies (issue #1338, and the matching
  // walk in `staffingWeek`, src/db/staffing.ts).
  const ratioGap = divemasterRatioGap({
    divers: trip.bookedDivers,
    divemasterCount: inWaterDivemasterCount(counts),
    diversPerDivemaster,
    // A departure the shop has marked self-guided raises neither of the
    // two rows below. Read here rather than branched on afterwards, so
    // this queue and the trip page cannot disagree (issue #973).
    selfGuided: trip.selfGuided,
  });
  // **No divemaster outranks the instructor gap.** A course session
  // with no crew at all satisfies both rules, and issue #732 settled that a
  // departure carries one row for one underlying fact — but that rule is
  // about the count, not about which code wins. The course gap winning
  // outright meant an empty boat said "This course session has no instructor
  // assigned", a sentence that mentions no divemaster and so reads as though
  // one is already aboard.
  //
  // `divemasterRatioGap` decides rather than a bare `inWaterDivemasterCount
  // === 0`, because the count alone is also true where "no crew" would be
  // the wrong thing to say: a self-guided departure wants no supervisor, and
  // one with nobody booked has no one to supervise. Both keep the instructor
  // sentence, which stays true and actionable for them — a session without
  // an instructor cannot take an enrolment however empty it is.
  //
  // Two things this is safe because of, neither obvious from the code.
  // `over_ratio` can never be the suppressed code: it requires
  // `instructorCount >= 1` (src/lib/course-ratios.ts), which forces a
  // non-zero in-water count, so `uncrewed` is always false when it fires and
  // a ratio breach can never hide behind a zero-crew row. And the shop's own
  // `diversPerDivemaster` cannot route a departure between these rows —
  // with divers aboard and nobody in the water, `ceil(divers / ratio) >= 1`
  // across the whole legal range (`MIN_`/`MAX_DIVERS_PER_DIVEMASTER`), so
  // `under_target` always holds and only the two exemptions decide. A
  // shop-set preference deciding whether a supervision signal appears would
  // be alarming; it cannot.
  const uncrewed = ratioGap.code === "under_target" && ratioGap.divemasterCount === 0;
  // **A gap a lapse opened says so, and only that gap** (issue #1853).
  // `counts` reads each rostered professional's recorded ratings, so a crew
  // list with an instructor's name on it can still raise these rows. The
  // same three answers are taken again on the roster's claim, and a row
  // carries the lapse only when the roster would not have raised it: a
  // divemaster's lapsed card beside a session nobody rostered an instructor
  // on is not why it has no instructor (dive-domain review). Never a refusal
  // — the booking gate still reads the roster's claim (H-59).
  const rosterCrewGap = courseCrewGap({
    course: trip.course,
    instructorCount: counts.roster.instructorCount,
    assistantCount: counts.roster.assistantCount,
    booked: trip.booked,
  });
  const rosterRatioGap = divemasterRatioGap({
    divers: trip.bookedDivers,
    divemasterCount: inWaterDivemasterCount(counts.roster),
    diversPerDivemaster,
    selfGuided: trip.selfGuided,
  });
  const rosterUncrewed =
    rosterRatioGap.code === "under_target" && rosterRatioGap.divemasterCount === 0;
  const lapseNote =
    counts.lapsed.length > 0 ? ratingLapsedDetailText(t, locale, counts.lapsed) : null;
  const explainedIf = (opened: boolean, detail: string) =>
    opened && lapseNote ? `${detail} ${lapseNote}` : detail;
  // Who lost the instructor rung — the only people who can be why a session
  // reads as having no instructor.
  const lostInstructor = counts.lapsed.filter((member) => member.lost === "instructor");
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
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: explainedIf(
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
