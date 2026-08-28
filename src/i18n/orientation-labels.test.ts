import { describe, expect, it } from "vitest";
import { STAFF_DESTINATIONS } from "@/lib/staff-destinations";
import { type OrientationRole, orientationTourHref } from "./orientation-labels";

const ROLES: readonly OrientationRole[] = [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
];

describe("orientationTourHref", () => {
  /**
   * The divemaster's "Try:" prompt pointed at `/shop/<slug>/blockers`, a 308 to
   * a surface that then moved twice: first to Today's by-departure view, then —
   * with that view — into the day spine itself (ADR
   * 20260827-clearwater-surface-language, decision 4). A staff link lands in
   * one hop, and it carries no query, because there is no view to select.
   */
  it("sends a divemaster to the bare home, in one hop and with no view query", () => {
    const href = orientationTourHref("blue-mantis", "divemaster", undefined);
    expect(href).toBe("/shop/blue-mantis");
    expect(href).not.toContain("?");
  });

  it("points every role at a destination the registry declares", () => {
    const known = new Set(
      STAFF_DESTINATIONS.map((destination) => `/shop/blue-mantis${destination.suffix}` as string),
    );
    for (const role of ROLES) {
      expect(known).toContain(orientationTourHref("blue-mantis", role, undefined));
    }
  });

  /** A captain with a boat out today goes to that boat, not to the board. */
  it("prefers today's boarding surface for a captain when there is one", () => {
    expect(
      orientationTourHref("blue-mantis", "captain", "/shop/blue-mantis/trips/t1/manifest"),
    ).toBe("/shop/blue-mantis/trips/t1/manifest");
  });
});
