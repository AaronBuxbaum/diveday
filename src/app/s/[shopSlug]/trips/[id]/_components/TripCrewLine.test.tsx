// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { groupLabelClass } from "@/components/ui/ledger";
import type { PublicCrewMember } from "@/db/trips";
import { TripCrewLine } from "./TripCrewLine";

/**
 * **The people, not a faceless crew label** (issue #1181, D21) — and the three
 * things this line will not say, which is the half worth guarding.
 */

afterEach(cleanup);

function member(over: Partial<PublicCrewMember> = {}): PublicCrewMember {
  return {
    personId: "person-1",
    firstName: "Marcus",
    tripRole: "divemaster",
    languages: ["en", "es"],
    ...over,
  };
}

describe("TripCrewLine", () => {
  it("names each crew member with their job and their languages", () => {
    render(<TripCrewLine crew={[member()]} locale="en-US" />);
    expect(screen.getByText("Who you’re diving with")).toBeInTheDocument();
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Marcus");
    expect(row).toHaveTextContent("Divemaster");
    // The languages are the reason a diver reads this at all.
    expect(row.textContent).toMatch(/English/);
    expect(row.textContent).toMatch(/Spanish|Español/);
  });

  /**
   * The restraint. A shop whose staff have consented to nothing — which is
   * every shop until somebody switches it on — must see no heading, not an
   * empty one. `tripPublicCrew` returns `[]` for that case and this is what it
   * does with it.
   */
  it("renders nothing at all when nobody has agreed to be named", () => {
    const { container } = render(<TripCrewLine crew={[]} locale="en-US" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still names somebody the roster gave no job to", () => {
    // A crew member with no per-trip role is a real row (`tripRole` is
    // nullable by design, ADR 20260803-per-trip-crew-role) and their languages
    // are the point, so the line renders without inventing a title for them.
    render(<TripCrewLine crew={[member({ tripRole: null })]} locale="en-US" />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Marcus");
    expect(row.textContent).toMatch(/English/);
    expect(row.textContent).not.toMatch(/Divemaster|Crew|Captain|Instructor/);
  });

  /**
   * **One of the door's sections, titled as its siblings are** (pixel-craft
   * class 12, K-381). The route, the field guide, the moments and the site
   * notes behind the pitch's door each open on a `GroupLabel`; this one was a
   * 14px semibold `<h2>` in the body's ink, and read as a sub-heading of the
   * last dive site above it.
   */
  it("opens on the door's group label, as an h2", () => {
    render(<TripCrewLine crew={[member()]} locale="en-US" />);
    const heading = screen.getByRole("heading", { level: 2, name: "Who you’re diving with" });
    expect(heading).toHaveClass(...groupLabelClass().split(" "));
    expect(heading).not.toHaveClass("text-sm");
  });

  it("brings no outer margin of its own", () => {
    // Its two callers space it differently — `/ready` in the thread's one
    // `space-y-10` run, the pitch's door body 24px under the beat above — and
    // a built-in `mt-6` stepped /ready's column 24px where every other
    // section stood 40 apart (K-233). The caller says where it sits.
    const { container } = render(<TripCrewLine crew={[member()]} locale="en-US" />);
    expect(container.querySelector("section")?.className ?? "").not.toMatch(/(^|\s)m[ty]?-/);

    cleanup();
    const placed = render(<TripCrewLine crew={[member()]} locale="en-US" className="mt-6" />);
    expect(placed.container.querySelector("section")).toHaveClass("mt-6");
  });

  it("names somebody who has declared no languages, and claims none for them", () => {
    render(<TripCrewLine crew={[member({ languages: [] })]} locale="en-US" />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Marcus");
    expect(row).toHaveTextContent("Divemaster");
    expect(row.textContent?.trim().endsWith("Divemaster")).toBe(true);
  });
});
