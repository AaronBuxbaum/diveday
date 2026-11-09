import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  drawnTripIds,
  EMPTY_SCHEDULE_TEXT,
  judgeSchedule,
  tripHrefPattern,
  visibleScheduleSnapshot,
} from "./public-schedule-canary.mjs";

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

afterEach(() => vi.unstubAllGlobals());

describe("visible schedule DOM evidence", () => {
  const probe = { pattern: tripHrefPattern("blue-mantis").source, emptyText: EMPTY_SCHEDULE_TEXT };
  function fixture(markup) {
    const dom = new JSDOM(markup, {
      url: "https://dive.day/s/blue-mantis",
      pretendToBeVisual: true,
    });
    // jsdom has no layout engine. Give every drawn box geometry; CSS/ancestor
    // visibility is still resolved by the actual DOM and computed style.
    dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20, top: 5000 }];
    vi.stubGlobal("document", dom.window.document);
    return dom.window.document;
  }
  const link = `<a href="/s/blue-mantis/trips/${ID}">Departure</a>`;
  it.each([
    "hidden",
    'style="display:none"',
    'style="visibility:hidden"',
    'style="opacity:0"',
    "inert",
  ])("rejects a hidden-only Activity/streamed copy: %s", (attribute) => {
    fixture(`<main><div ${attribute}>${link}</div></main>`);
    expect(visibleScheduleSnapshot({ ...probe, readyOnly: true })).toBe(false);
    expect(visibleScheduleSnapshot(probe).hrefs).toEqual([]);
  });
  it("counts a visible departure below the fold, deduplicating hidden copies", () => {
    fixture(`<main><div hidden>${link}</div><section>${link}${link}</section></main>`);
    const state = visibleScheduleSnapshot(probe);
    expect(visibleScheduleSnapshot({ ...probe, readyOnly: true })).toBe(true);
    expect(judgeSchedule({ status: 200, ...state, slug: "blue-mantis" })).toEqual({
      ok: true,
      reason: "1 departure(s) drawn",
    });
  });
  it("ignores links outside the schedule, to another shop or another origin", () => {
    fixture(
      `${link}<main><a href="/s/other/trips/${ID}">Other</a><a href="https://example.test/s/blue-mantis/trips/${ID}">Foreign</a></main>`,
    );
    expect(visibleScheduleSnapshot({ ...probe, readyOnly: true })).toBe(false);
    expect(visibleScheduleSnapshot(probe).hrefs).toEqual([]);
  });
  it("waits for a streamed reveal instead of accepting its hidden shell", () => {
    const doc = fixture(`<main><div hidden>${link}</div></main>`);
    expect(visibleScheduleSnapshot({ ...probe, readyOnly: true })).toBe(false);
    doc.querySelector("[hidden]").removeAttribute("hidden");
    expect(visibleScheduleSnapshot({ ...probe, readyOnly: true })).toBe(true);
  });
  it("retains the visible empty-state diagnostic, never using hidden empty copy", () => {
    const doc = fixture(`<main><p hidden>${EMPTY_SCHEDULE_TEXT}</p></main>`);
    expect(visibleScheduleSnapshot({ ...probe, readyOnly: true })).toBe(false);
    doc.querySelector("p").removeAttribute("hidden");
    expect(visibleScheduleSnapshot({ ...probe, readyOnly: true })).toBe(true);
    const state = visibleScheduleSnapshot(probe);
    expect(judgeSchedule({ status: 200, ...state, slug: "blue-mantis" }).reason).toContain(
      EMPTY_SCHEDULE_TEXT,
    );
  });
});
