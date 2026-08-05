// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RequirementsSection } from "./RequirementsSection";
import type { Requirement, SiteRequirement, Trip } from "./types";

afterEach(cleanup);

/**
 * Only the four fields this section reads. The full `getTripWithBooked` row is
 * not what is under test — *which site the gate is attributed to* is.
 */
const tripRow = (course: Trip["course"] = null) =>
  ({
    id: "trip-1",
    title: "Two-Tank Reef",
    course,
    diveSite: { id: "site-1", name: "Molasses Reef" },
  }) as unknown as Trip;

const requirement = {
  requiresWaiver: true,
  requiresPayment: false,
  minimumCertificationLevel: "open_water",
  requiredSpecialties: [],
  requiresNitrox: false,
} as unknown as Requirement;

/** A gate that, on the seeded two-site day, comes from the *second* tank. */
const deepGate = {
  minimumCertificationLevel: "advanced_open_water",
  requiredSpecialties: ["deep"],
  requiresNitrox: false,
} as unknown as SiteRequirement;

const noop = () => {};

describe("RequirementsSection — which site the extra gate is attributed to", () => {
  it("names the one site a single-site trip visits", () => {
    render(
      <RequirementsSection
        action={noop}
        trip={tripRow()}
        requirement={requirement}
        siteRequirement={deepGate}
        siteNames={["Spiegel Grove"]}
        locale="en-US"
      />,
    );
    expect(screen.getByText(/Spiegel Grove/)).toBeTruthy();
    expect(screen.getByText(/also requires/)).toBeTruthy();
  });

  /**
   * The regression. `getTripSiteRequirement` unions every site the trip visits,
   * so on a two-site day whose Deep gate comes from tank two, naming
   * `trip.diveSite` (tank one's site, copied onto the trip row) sent staff to
   * the wrong site card to understand or change the rule.
   */
  it("names every site a two-site trip visits, never just the first", () => {
    render(
      <RequirementsSection
        action={noop}
        trip={tripRow()}
        requirement={requirement}
        siteRequirement={deepGate}
        siteNames={["Molasses Reef", "Spiegel Grove"]}
        locale="en-US"
      />,
    );
    expect(screen.getByText(/Molasses Reef/)).toBeTruthy();
    expect(screen.getByText(/Spiegel Grove/)).toBeTruthy();
    // Plural subject takes the plural verb.
    expect(screen.getByText(/together require/)).toBeTruthy();
    expect(screen.queryByText(/also requires/)).toBeNull();
  });

  it("falls back to 'this site' rather than a wrong name when no site is chosen", () => {
    render(
      <RequirementsSection
        action={noop}
        trip={tripRow()}
        requirement={requirement}
        siteRequirement={deepGate}
        siteNames={[]}
        locale="en-US"
      />,
    );
    expect(screen.getByText(/This site/)).toBeTruthy();
    expect(screen.queryByText(/Molasses Reef/)).toBeNull();
  });

  it("keeps the same attribution on a course session, whose gate staff cannot edit", () => {
    render(
      <RequirementsSection
        action={noop}
        trip={tripRow({ id: "course-1", title: "Deep Diver", slug: "deep-diver" } as never)}
        requirement={requirement}
        siteRequirement={deepGate}
        siteNames={["Molasses Reef", "Spiegel Grove"]}
        locale="en-US"
      />,
    );
    expect(screen.getByText(/Molasses Reef/)).toBeTruthy();
    expect(screen.getByText(/Spiegel Grove/)).toBeTruthy();
    // The course wording, plural — never the singular "requires".
    expect(screen.getByText(/sites’ own rules|sites' own rules/)).toBeTruthy();
  });

  it("says nothing at all when no visited site demands anything", () => {
    render(
      <RequirementsSection
        action={noop}
        trip={tripRow()}
        requirement={requirement}
        siteRequirement={null}
        siteNames={["Molasses Reef", "Spiegel Grove"]}
        locale="en-US"
      />,
    );
    expect(screen.queryByText(/together require/)).toBeNull();
    expect(screen.queryByText(/also requires/)).toBeNull();
  });
});
