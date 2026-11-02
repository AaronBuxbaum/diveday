import { describe, expect, it } from "vitest";

import { drawnTripIds, EMPTY_SCHEDULE_TEXT, judgeSchedule } from "./public-schedule-canary.mjs";

const ID = "330169fd-1111-4222-8333-444455556666";
const OTHER = "0a0a0a0a-1111-4222-8333-444455556666";

describe("drawnTripIds", () => {
  it("counts a departure once however many links reach it", () => {
    expect(
      drawnTripIds(
        [`/s/blue-mantis/trips/${ID}`, `/s/blue-mantis/trips/${ID}/calendar`],
        "blue-mantis",
      ),
    ).toEqual([ID]);
  });

  it("reads absolute links and ignores another shop's, the trips index and non-links", () => {
    expect(
      drawnTripIds(
        [
          `https://dive.day/s/blue-mantis/trips/${OTHER}?x=1`,
          `/s/other-shop/trips/${ID}`,
          "/s/blue-mantis/trips",
          "/s/blue-mantis/courses/open-water",
          null,
        ],
        "blue-mantis",
      ),
    ).toEqual([OTHER]);
  });

  it("takes a slug with a dot literally", () => {
    expect(drawnTripIds([`/s/a-b/trips/${ID}`], "a.b")).toEqual([]);
  });
});

describe("judgeSchedule", () => {
  const slug = "blue-mantis";

  it("passes a page that links a departure", () => {
    expect(
      judgeSchedule({ status: 200, hrefs: [`/s/${slug}/trips/${ID}`], text: "", slug }).ok,
    ).toBe(true);
  });

  it("fails an empty shell, and says when the page owns up to it", () => {
    const shell = judgeSchedule({
      status: 200,
      hrefs: ["/s/blue-mantis/courses"],
      text: "Blue Mantis",
      slug,
    });
    expect(shell).toEqual({ ok: false, reason: "the schedule loaded and links no departure" });
    const empty = judgeSchedule({ status: 200, hrefs: [], text: EMPTY_SCHEDULE_TEXT, slug });
    expect(empty.ok).toBe(false);
    expect(empty.reason).toContain(EMPTY_SCHEDULE_TEXT);
  });

  it("fails anything but a 200 before reading the page", () => {
    const verdict = judgeSchedule({
      status: 503,
      hrefs: [`/s/${slug}/trips/${ID}`],
      text: "",
      slug,
    });
    expect(verdict).toEqual({ ok: false, reason: "the schedule answered 503, not 200" });
  });
});
