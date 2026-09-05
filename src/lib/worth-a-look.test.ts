import { describe, expect, it } from "vitest";
import { type WorthALookCandidate, type WorthALookSubject, worthALook } from "./worth-a-look";

const TIMEZONE = "America/New_York";
// 2026-09-05 is a Saturday; 11:00 New York is 15:00 UTC, a morning boat.
const NOW = new Date("2026-09-05T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

const subject = (over: Partial<WorthALookSubject> = {}): WorthALookSubject => ({
  tripId: "subject",
  courseId: null,
  diveSiteId: null,
  difficultyLevel: null,
  startsAt: at("2026-09-06T15:00:00.000Z"),
  seatsOpen: 6,
  ...over,
});

const candidate = (
  tripId: string,
  over: Partial<WorthALookCandidate> = {},
): WorthALookCandidate => ({
  tripId,
  title: `Boat ${tripId}`,
  courseId: null,
  diveSiteId: null,
  difficultyLevel: null,
  // A Monday afternoon in New York: 18:00 UTC is 14:00 local.
  startsAt: at("2026-09-07T18:00:00.000Z"),
  seatsOpen: 6,
  ...over,
});

const look = (subj: WorthALookSubject, candidates: WorthALookCandidate[], limit?: number) =>
  worthALook({ subject: subj, candidates, timeZone: TIMEZONE, limit, now: NOW });

describe("worthALook", () => {
  it("offers nothing when nothing on the board is related", () => {
    // Four unrelated afternoon boats beside a morning departure with no course,
    // no site and plenty of room: the honest answer is silence, and the page
    // renders no section at all.
    const rows = look(subject(), [candidate("a"), candidate("b"), candidate("c"), candidate("d")]);
    expect(rows).toEqual([]);
  });

  it("never offers the departure back to itself", () => {
    const subj = subject({ diveSiteId: "molasses" });
    const rows = look(subj, [
      { ...candidate("subject", { diveSiteId: "molasses" }), tripId: "subject" },
    ]);
    expect(rows).toEqual([]);
  });

  it("does not read two absences as a match", () => {
    // A fun dive with no site set is not "the same site" as every other fun
    // dive with no site set.
    const rows = look(subject({ startsAt: at("2026-09-06T15:00:00.000Z") }), [
      candidate("a", { startsAt: at("2026-09-08T18:00:00.000Z") }),
    ]);
    expect(rows).toEqual([]);
  });

  it("prefers the same course over the same site", () => {
    const subj = subject({ courseId: "ow", diveSiteId: "molasses" });
    const rows = look(subj, [
      candidate("site", { diveSiteId: "molasses" }),
      candidate("course", { courseId: "ow" }),
    ]);
    expect(rows[0]).toMatchObject({ tripId: "course", reason: "same_course" });
    expect(rows[1]).toMatchObject({ tripId: "site", reason: "same_site" });
  });

  it("says gentler for a beginner site, and has no word for the reverse", () => {
    const demanding = subject({ difficultyLevel: "advanced" });
    expect(look(demanding, [candidate("easy", { difficultyLevel: "beginner" })])).toMatchObject([
      { tripId: "easy", reason: "gentler" },
    ]);
    // There is deliberately no code for "harder": the moment this comparator
    // can push a diver up a grade it has stopped being guidance (#1161).
    const easy = subject({ difficultyLevel: "beginner" });
    expect(look(easy, [candidate("hard", { difficultyLevel: "advanced" })])).toEqual([]);
    // A site the shop has not rated is never guessed at, in either direction.
    expect(look(demanding, [candidate("unrated", { difficultyLevel: null })])).toEqual([]);
  });

  it("reads the part of the day in the shop's own zone", () => {
    // 15:00 UTC is 11:00 in New York — a morning boat — and so is 14:00 UTC.
    const morning = subject({ startsAt: at("2026-09-06T15:00:00.000Z") });
    expect(
      look(morning, [candidate("also-morning", { startsAt: at("2026-09-07T14:00:00.000Z") })]),
    ).toMatchObject([{ tripId: "also-morning", reason: "same_time_of_day" }]);
    // 22:00 UTC is 18:00 in New York, an evening boat, and no longer a match.
    expect(
      look(morning, [candidate("evening", { startsAt: at("2026-09-07T22:00:00.000Z") })]),
    ).toEqual([]);
  });

  it("offers more room only to a departure that is nearly out of it", () => {
    const tight = subject({ seatsOpen: 2, startsAt: at("2026-09-06T15:00:00.000Z") });
    expect(
      look(tight, [candidate("roomy", { seatsOpen: 8, startsAt: at("2026-09-08T22:00:00.000Z") })]),
    ).toMatchObject([{ tripId: "roomy", reason: "more_room", seatsOpen: 8 }]);
    // Six seats left is not a problem the page needs to solve.
    const roomy = subject({ seatsOpen: 6, startsAt: at("2026-09-06T15:00:00.000Z") });
    expect(
      look(roomy, [
        candidate("roomier", { seatsOpen: 8, startsAt: at("2026-09-08T22:00:00.000Z") }),
      ]),
    ).toEqual([]);
  });

  it("never prints the same reason twice, and caps at two", () => {
    const subj = subject({ diveSiteId: "molasses", startsAt: at("2026-09-06T15:00:00.000Z") });
    const rows = look(subj, [
      candidate("site-1", { diveSiteId: "molasses", startsAt: at("2026-09-07T18:00:00.000Z") }),
      candidate("site-2", { diveSiteId: "molasses", startsAt: at("2026-09-08T18:00:00.000Z") }),
      candidate("site-3", { diveSiteId: "molasses", startsAt: at("2026-09-09T18:00:00.000Z") }),
      candidate("morning", { startsAt: at("2026-09-09T14:00:00.000Z") }),
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(({ reason }) => reason)).size).toBe(2);
    // Soonest first within a reason, so the earliest same-site boat is the one
    // that speaks for the reason.
    expect(rows[0]).toMatchObject({ tripId: "site-1", reason: "same_site" });
  });

  it("leaves a departure that has already sailed off the board", () => {
    // The standing 1-hour late-arrival buffer: a boat scheduled forty minutes
    // ago is usually still at the dock, one scheduled two hours ago is not.
    const subj = subject({ diveSiteId: "molasses" });
    const stillHere = candidate("late", {
      diveSiteId: "molasses",
      startsAt: new Date(NOW.getTime() - 40 * 60 * 1000),
    });
    const gone = candidate("gone", {
      diveSiteId: "molasses",
      startsAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });
    expect(look(subj, [gone])).toEqual([]);
    expect(look(subj, [stillHere])).toMatchObject([{ tripId: "late" }]);
  });

  it("orders totally, so two boats at the same minute never swap", () => {
    const subj = subject({ diveSiteId: "molasses" });
    const same = at("2026-09-07T18:00:00.000Z");
    const forwards = look(
      subj,
      [
        candidate("b", { diveSiteId: "molasses", startsAt: same }),
        candidate("a", { diveSiteId: "molasses", startsAt: same }),
      ],
      1,
    );
    const backwards = look(
      subj,
      [
        candidate("a", { diveSiteId: "molasses", startsAt: same }),
        candidate("b", { diveSiteId: "molasses", startsAt: same }),
      ],
      1,
    );
    expect(forwards).toEqual(backwards);
    expect(forwards[0]?.tripId).toBe("a");
  });

  it("takes the caller's word that every candidate has a seat", () => {
    // The pool comes from `pagedUpcomingTripsWithCounts(..., { hasSpace: true })`,
    // so a full boat never reaches this comparator and it does not re-filter
    // one. The call site is where that invariant is asserted.
    expect(look(subject({ diveSiteId: "molasses" }), [])).toEqual([]);
  });
});
