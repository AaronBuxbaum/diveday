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
   * The divemaster's "Try:" prompt pointed at `/shop/<slug>/blockers`, which
   * has been a 308 to Today's by-departure view since ADR
   * 20260803-not-ready-is-a-view. A staff link should land in one hop, and the
   * registry has known the one-hop URL — query string and all — the whole time.
   */
  it("sends a divemaster straight to the by-departure view, not through the 308", () => {
    expect(orientationTourHref("blue-mantis", "divemaster", undefined)).toBe(
      "/shop/blue-mantis?view=departures",
    );
  });

  it("points every role at a destination the registry declares", () => {
    const known = new Set(
      STAFF_DESTINATIONS.map(
        (destination) =>
          `/shop/blue-mantis${destination.suffix}${destination.query ?? ""}` as string,
      ),
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
