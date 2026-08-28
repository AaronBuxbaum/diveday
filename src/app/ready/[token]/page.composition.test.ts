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

/**
 * **The thread's third state** — ADR 20260827-the-divers-thread, decision 4
 * (slice 7d). The behavioural rules are pinned where they can be rendered
 * (`_components/AfterState.test.tsx`) and where the switch itself lives
 * (`src/lib/thread-steps.test.ts`); what only the route can say is *where the
 * branch sits* and *which token the recap actions are handed*.
 */
describe("after the dive", () => {
  it("decides the state before it composes any of the prep page", () => {
    // Everything below the branch — the party's claim panel, the trip read the
    // packing list needs, the payment receipt — is about a day that has not
    // happened yet. Composing it and then throwing it away would be several
    // queries and one long file's worth of reasoning spent on a diver who is
    // already home.
    const after = positionOf("<AfterState");
    expect(after).toBeGreaterThan(-1);
    expect(after).toBeLessThan(positionOf("<ThreadStatus"));
  });

  it("switches on the shared rule rather than a literal of its own", () => {
    // Both timings live in `src/lib/thread-steps.ts` — the standing one-hour
    // late-arrival buffer and the four-hour recap floor. A literal
    // `60 * 60 * 1000` here is how "has it sailed" and "is it over" drift an
    // hour apart.
    expect(SOURCE).toContain("isAfterTheDive({ endsAt: detail.trip.endsAt, boarded })");
    expect(SOURCE).not.toContain("60 * 60 * 1000");
  });

  it("asks the crew's own roll call before it says anybody dived", () => {
    // The switch was the clock alone until a review caught it (2026-08-28): a
    // diver who never boarded — overslept, or held at the desk on a medical
    // hold — opened the durable link already in their inbox an hour after the
    // boat was back and got "Welcome back", a printable dive record for the
    // day, and an invitation to tip the crew who dived without them.
    // `roll_call_events` is the only direct evidence DiveDay holds about who
    // got on the boat, and the page consults it before composing the afterglow.
    const rollCall = positionOf("departureRollCallForBooking(");
    expect(rollCall).toBeGreaterThan(-1);
    expect(rollCall).toBeLessThan(positionOf("isAfterTheDive("));
    // Only once the boat is scheduled home: an ordinary night-before page load
    // never pays for the query.
    expect(SOURCE).toContain("theBoatIsHome({ endsAt: detail.trip.endsAt })");
  });

  it("answers a cancelled departure before it composes anything else", () => {
    // A blow-out cancels the *trip* and deliberately leaves every booking
    // active (src/db/blowouts.ts), so `detail.cancelled` is false for every
    // diver a cancellation stranded — and this page read only that. Before the
    // boat was due back it handed them a packing list; an hour after it, the
    // afterglow.
    const departure = positionOf("data.departureCancelled");
    expect(departure).toBeGreaterThan(-1);
    expect(departure).toBeLessThan(positionOf("<AfterState"));
    expect(departure).toBeLessThan(positionOf("<ThreadStatus"));
  });

  it("names the shop on both of its live-token dead ends", () => {
    // A cancelled departure and a no-show are not expired links: the token
    // verified, the shop is already in scope, and the reader's question is
    // *who do I ask*. Issue #801 gave the expired branch the shop's name and
    // contact details for exactly that reason; these two named nobody.
    expect(countOf("shop={shopContact}")).toBe(2);
    expect(SOURCE).toContain('t("recap.noShowHeading")');
    // And never the pair of sentences it replaced — "This readiness link isn't
    // available" over "This booking didn't sail" — both false for this reader.
    expect(SOURCE).not.toContain('t("recap.didNotDiveBody")');
  });

  it("binds the recap actions to a recap token, never to this page's own", () => {
    // `/ready`'s token is a bearer capability that can cancel the booking and
    // move its refund; the recap actions verify a *recap* token, and the two
    // are domain-separated on purpose (src/lib/recap-links.ts). Widening
    // either side would hand a review form the power to release a seat.
    expect(SOURCE).toContain("signRecapToken(bookingId)");
    for (const action of ["submitReviewAction", "uploadRecapPhotoAction", "startTipAction"]) {
      expect(SOURCE).not.toContain(`${action}.bind(null, token)`);
    }
  });
});
