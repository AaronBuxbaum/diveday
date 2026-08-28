import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The order the trip page composes in, pinned as a rule.**
 *
 * ADR 20260827-the-divers-thread, decision 2: "the hero ... the pitch ... who
 * it's for ... then **the form, terminal** — nothing below it but the fine
 * print it already owns." Until 2026-08-28 it ran the other way round: the form
 * sat directly under the hero, and the forecast, the packing list and the dive
 * briefings — roughly a thousand pixels of reading — followed it, which put the
 * page's one act in the middle of its own scroll.
 *
 * This reads the route's source because the thing being pinned is a *server*
 * page's composition: there is no render to inspect without a database, a
 * request and a shop, and an e2e spec that scrolls the real page cannot say
 * *why* a section is where it is. The same shape as
 * `src/i18n/provider-coverage.test.ts`, and for the same reason.
 */

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

/**
 * Where a marker first appears in the route's source, or -1.
 *
 * No marker below is a dotted message key: `src/i18n/raw-messages.test.ts`
 * sweeps the whole tree for any one-argument call whose only argument is a
 * dotted key string, and reads one here as a translator formatting a message
 * with no values for its placeholders. Markers name JSX instead.
 */
function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

describe("the trip page's order", () => {
  it("runs pitch, then requirement, then the form, then the contact line", () => {
    const pitch = positionOf("<TripDayPlan");
    const lookFor = positionOf("<TripLookFor");
    const conditions = positionOf("<ConditionsLine");
    const requirement = positionOf("{requirementNote ? (");
    const form = positionOf("<BookSpotSection");
    const contact = positionOf("<ShopContactLinks");

    for (const marker of [pitch, lookFor, conditions, requirement, form, contact]) {
      expect(marker).toBeGreaterThan(-1);
    }
    expect(pitch).toBeLessThan(lookFor);
    expect(lookFor).toBeLessThan(conditions);
    expect(conditions).toBeLessThan(requirement);
    expect(requirement).toBeLessThan(form);
    expect(form).toBeLessThan(contact);
  });

  it("renders no forecast, packing or briefing section below the form", () => {
    // The form card is the last *section*. Only the shop's contact line
    // follows it, and every state that stands in the form's place
    // (`TripFullSection`, `TripSailedNotice`, …) shares its slot rather than
    // sitting after it.
    // Named as elements and as imports, not as words: the prose above the
    // composition still explains where packing went, and a rule that trips on
    // its own explanation teaches people to delete the explanation.
    for (const component of ["PackingSection", "DiveBriefingsSection", "ForecastSection"]) {
      expect(SOURCE).not.toContain(`<${component}`);
      expect(SOURCE).not.toContain(`./_components/${component}`);
    }
  });

  it("joins the thread's measure", () => {
    // Every page a booked diver walks reads at `max-w-xl` (decision 1). The
    // trip page was the last `max-w-2xl` on that walk.
    expect(SOURCE).toContain("max-w-xl");
    expect(SOURCE).not.toContain("max-w-2xl");
  });

  it("keeps the sticky phone pill a verb pointing at the form", () => {
    // It carried the seat count ("Book · 3 left"), which is the fact the card
    // it scrolls to already states in its own corner.
    expect(SOURCE).toContain("bookVerb");
    expect(SOURCE).not.toContain("bookAndSpotsLeft");
    expect(SOURCE).toContain('href="#book"');
    expect(SOURCE).toContain("{!confirmed && !inPast && !trip.conditionsHold ? (");
  });

  it("suppresses the requirement sentence for a course session", () => {
    // A course states its own admission rule on its own page, and its
    // itinerary's gate is deliberately not a booking gate — repeating the
    // site's demand here would read as a bar on the very students the course
    // exists to create.
    expect(SOURCE).toContain("const combinedRequirement = trip.course\n    ? null");
  });

  it("leaves the departure's unfurl card untouched", () => {
    // A page-level `openGraph` block *replaces* the root layout's rather than
    // merging into it, so a recomposition that quietly drops the spread takes
    // `og:site_name` and `og:type` off every departure's link preview.
    expect(SOURCE).toContain("openGraph: {\n      ...openGraphSite,");
    expect(SOURCE).toContain("alternates: { canonical },");
    expect(SOURCE).toContain("robots: shopSearchListingRobots(shop.searchListingOptOutAt),");
  });

  it("leaves the embed contract exactly where it was", () => {
    // `?embed=1` drops the chrome and the back link, the `confirm` capability
    // is the whole gate on `?booking=`, and no structured data is emitted in
    // the frame (the embed points its canonical at this page).
    expect(SOURCE).toContain('const isEmbed = embed === "1";');
    expect(SOURCE).toContain("const structuredData = isEmbed\n    ? null");
    expect(SOURCE).toContain(
      'isEmbed && bookingToken\n      ? await verifyBookingCapability(db, { token: bookingToken, purpose: "confirm" })',
    );
    expect(SOURCE).toContain("const reviewAggregate = isEmbed ? null :");
  });
});
