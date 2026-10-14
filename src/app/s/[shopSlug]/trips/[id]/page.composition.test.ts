import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Which inputs the public trip page consults, pinned as rules.** Its layout
 * is the visual suite's to photograph; what stays here is the capability gate
 * on `?booking=`, the known-diver handoff and the projection the client gets.
 *
 * This reads the route's source because the thing being pinned is a *server*
 * page's composition: there is no render to inspect without a database, a
 * request and a shop, and an e2e spec that scrolls the real page cannot say
 * *why* a section is where it is. The same shape as
 * `scripts/check-intl-providers.mjs`, and for the same reason.
 */

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");
/** The page's one wave of reads, lifted beside it so the route stays a renderer (#2353). */
const READS_SOURCE = readFileSync(join(__dirname, "_lib/page-reads.ts"), "utf8");

/**
 * The source of a file the page composes, read by name: under the route's
 * `_components/`, or under `src/components/`. A section that moves out of the
 * page moves its pins with it by changing only the name passed here.
 */
function component(file: string): string {
  try {
    return readFileSync(join(__dirname, "_components", file), "utf8");
  } catch {
    return readFileSync(join(__dirname, "..", "..", "..", "..", "..", "components", file), "utf8");
  }
}

describe("the trip page's gates", () => {
  it("suppresses the requirement sentence for a course session", () => {
    // A course states its own admission rule on its own page, and its
    // itinerary's gate is deliberately not a booking gate — repeating the
    // site's demand here would read as a bar on the very students the course
    // exists to create.
    expect(SOURCE).toContain("const combinedRequirement = trip.course\n    ? null");
  });

  it("leaves the embed contract exactly where it was", () => {
    // `?embed=1` drops the chrome and the back link, the `confirm` capability
    // is the whole gate on `?booking=`, and no structured data is emitted in
    // the frame (the embed points its canonical at this page).
    expect(SOURCE).toContain('const isEmbed = embed === "1";');
    expect(SOURCE).toContain("const structuredData = isEmbed\n    ? null");
    expect(READS_SOURCE).toContain(
      'isEmbed && bookingToken\n      ? verifyBookingCapability(db, { token: bookingToken, purpose: "confirm" }).then(',
    );
    // The booking is read only off a capability that verified, and nowhere else.
    expect(SOURCE).not.toContain("getBookingForTrip(");
    expect(READS_SOURCE.split("getBookingForTrip(").length - 1).toBe(1);
    expect(READS_SOURCE).toMatch(
      /\(capability\) =>\s*capability \? getBookingForTrip\(db, shop\.id, tripId, capability\.bookingId\) : null,/,
    );
    expect(READS_SOURCE).toContain(
      "isEmbed || !shop.reviewsEnabled ? null : getShopReviewAggregate(db, shop.id)",
    );
  });
});

/**
 * **The door remembers who opened it, and nobody else** (ADR
 * 20260906-before-you-ask, decision 3). A cold request renders the form that
 * ships: the known-diver facts are read only through a verified handoff, the
 * panel renders only off that read, and an email typed into the form never
 * reaches the page's own render. Pinned at the source, like the order above,
 * because what is being pinned is which *inputs* a server page consults.
 */
describe("the known diver's facts", () => {
  const SECTIONS = component("BookingSections.tsx");

  it("are read only through the handoff, and never on an embed", () => {
    const read = READS_SOURCE.indexOf("readKnownDiver(db, {");
    expect(read).toBeGreaterThan(-1);
    const guard = READS_SOURCE.lastIndexOf("handoffToken && !isEmbed", read);
    expect(guard).toBeGreaterThan(-1);
    // One read, and one guard directly above it.
    expect(SOURCE).not.toContain("readKnownDiver(");
    expect(READS_SOURCE.split("readKnownDiver(").length - 1).toBe(1);
    expect(read - guard).toBeLessThan(120);
  });

  it("render as a panel only when the read answered", () => {
    expect(SOURCE).toContain("const knownDiverPanel = knownDiver\n    ? {");
    expect(SECTIONS).toContain("{knownDiver ? (\n          <KnownDiverPanel");
  });

  it("never come from an email typed into the form", () => {
    // The cold-email path is an action that returns nothing and a form that
    // hears nothing back — the page consults no search param but the handoff.
    expect(READS_SOURCE).not.toMatch(/readKnownDiver\([^)]*email/);
    expect(SECTIONS).toContain(
      "onLeadEmailSettled={knownDiver || tripRef.embed ? undefined : offerHandoff}",
    );
  });
});

/**
 * **The booking form gets the departure's three public facts, not its row**
 * (security review, code review 2026-10-13 layer C). `BookSpotSection` and
 * `TripFullSection` are client components: whatever the page hands them is
 * serialized into the public payload, so the page projects the trip through
 * `bookingFormTrip` at both doors and the components accept nothing wider.
 */
describe("the trip the booking form is handed", () => {
  const SECTIONS = component("BookingSections.tsx");

  it("is projected at both client doors, never the raw row", () => {
    expect(SOURCE).toContain("trip: bookingFormTrip(trip),");
    expect(SOURCE).toContain(
      "<TripFullSection\n                  shopSlug={shopSlug}\n                  trip={bookingFormTrip(trip)}",
    );
    // Neither door takes the row itself. (`BookingFinePrint` inside them may:
    // it is a server component, rendered before anything crosses.)
    expect(SOURCE).not.toContain("context={{\n                    trip,\n");
    expect(SOURCE).not.toContain(
      "<TripFullSection\n                  shopSlug={shopSlug}\n                  trip={trip}",
    );
  });

  it("is typed as the projection on the client side", () => {
    expect(SECTIONS).toContain('"use client"');
    expect(SECTIONS).not.toMatch(/\btrip: Trip;/);
    expect(SECTIONS.split("trip: BookingFormTrip;").length - 1).toBe(2);
  });
});
