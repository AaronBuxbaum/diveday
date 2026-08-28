import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **What the thread page is, and what it stopped being** — ADR
 * 20260827-the-divers-thread, decision 3 and decision 6, pinned as rules.
 *
 * The page it replaced was 1,828 lines: nine checklist rows of which five were
 * inline forms open at once, a progress bar whose own copy admitted it could
 * never fill, and the booking's status stated four times in one screenful (an
 * earned moment, an emails line, a receipt panel, and the checklist's own
 * "Almost there" sentence). Every assertion below is one of those defects,
 * written so it cannot come back.
 *
 * It reads the route's source because the thing being pinned is a *server*
 * page's composition: there is no render to inspect without a database, a
 * request, a shop and a live capability token, and an e2e spec that scrolls
 * the real page cannot say *why* a section is where it is. Same shape as
 * `src/app/s/[shopSlug]/trips/[id]/page.composition.test.ts` and
 * `src/i18n/provider-coverage.test.ts`, for the same reason.
 */

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

/** Where a marker first appears in the route's source, or -1. */
function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

/** How many times it appears. */
function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

describe("the thread page's order", () => {
  it("runs status, spine, party, packing, the rare acts, then the shop", () => {
    const status = positionOf("<ThreadStatus");
    const spine = positionOf("<ThreadSpine");
    const party = positionOf("<PartyClaimPanel");
    const packing = positionOf("<PackingSection");
    const cancel = positionOf("<InlineConfirm");
    const shop = positionOf("<ShopCard");

    for (const marker of [status, spine, party, packing, cancel, shop]) {
      expect(marker).toBeGreaterThan(-1);
    }
    expect(status).toBeLessThan(spine);
    expect(spine).toBeLessThan(party);
    expect(party).toBeLessThan(packing);
    expect(packing).toBeLessThan(cancel);
    expect(cancel).toBeLessThan(shop);
  });
});

describe("status is said once", () => {
  it("renders exactly one status statement", () => {
    expect(countOf("<ThreadStatus")).toBe(1);
  });

  it("carries no progress bar", () => {
    // "A bar that cannot fill is not rendered" (decision 6). The figure counts
    // only steps a diver can finish, and a bar beside it would draw what the
    // two words next to it already say.
    expect(SOURCE).not.toContain("progressbar");
    expect(SOURCE).not.toContain("progress-wave-fill");
  });

  it("carries no receipt panel and no emails line", () => {
    // Both folded into their steps: the receipt's figure is the Pay step's
    // settled line, and the emails line was a third statement of the same
    // status. `EmbedBookedNotice` still carries the emails line where it is
    // the *only* thing the reader gets.
    expect(SOURCE).not.toContain("PaymentReceiptPanel");
    expect(SOURCE).not.toContain("booking.emailsOnTheWay");
  });
});

describe("the coral budget", () => {
  it("renders one earned moment, and only on ?booked=1", () => {
    expect(countOf("<EarnedMoment")).toBe(1);
    // The moment sits inside the `justBooked` branch and nothing else opens
    // it: `?booked=1` is flashed straight back out of the URL, so reopening
    // the link three days later replays nothing.
    const moment = positionOf("<EarnedMoment");
    const guard = SOURCE.lastIndexOf("{justBooked ? (", moment);
    expect(guard).toBeGreaterThan(-1);
    expect(moment - guard).toBeLessThan(900);
  });

  it("settles the all-set state into the status head rather than a second moment", () => {
    // The page used to fire a *second* `EarnedMoment` for `ready`, so a diver
    // arriving from a reminder with nothing left got a coral panel that
    // celebrates what the waiver page already celebrated. One moment does not
    // fire twice (decision 6).
    expect(SOURCE).not.toContain("ready.allSetHeading}\n            title");
    expect(SOURCE).toContain("settled={spine.done === spine.countable}");
  });
});

describe("what the thread no longer carries", () => {
  it("renders no dive-briefing deck", () => {
    // "What you'll see" is the trip page's pitch (`TripDayPlan`/`TripLookFor`)
    // and, after the boat is home, the keepsake's. What to *bring* is prep,
    // and prep is what this page is for.
    expect(SOURCE).not.toContain("DiveBriefingsSection");
    expect(SOURCE).not.toContain("listDiveSiteBriefingExtras");
  });

  it("still carries the packing list", () => {
    expect(SOURCE).toContain("<PackingSection");
  });
});
