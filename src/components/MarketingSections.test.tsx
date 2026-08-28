// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarketingMockup, marketingMockups } from "./MarketingSections";

afterEach(cleanup);

/**
 * The mockup registry the homepage's daily-moments band reads. The band builds
 * its rows from data, so a row's illustration is a registry entry rather than
 * an import at the call site — and the accessible name of every one of them is
 * resolved by the *caller* from a message bundle, never written into the
 * component. These pin both halves.
 */
describe("marketingMockups", () => {
  it("carries one illustration per moment the homepage tells", () => {
    // The day the band tells: a diver books, the desk clears the boat, the
    // diver goes home with something worth sending on. The evening entry
    // landed 2026-08-28 (docs/product/marketing-review-20260827.md).
    expect(Object.keys(marketingMockups)).toEqual(["diverBooking", "frontDeskReadiness", "recap"]);
  });

  it("renders the recap screen the product page's after-trip chapter also shows", () => {
    render(<div>{marketingMockups.recap.render("en-US")}</div>);
    // **The keepsake and the one ask** — no longer a photos section. Slice 7d
    // recomposed the after-state around the dive-log entry, the crew's note and
    // a single review ask, with photos and tipping demoted to quiet doors, and
    // the mockup follows the surface rather than the other way round. Asserted
    // on the two blocks that carry the argument this screen is on the product
    // page to make: the shop wrote something, and the diver is asked once.
    expect(screen.getByText("Dive log entry")).toBeInTheDocument();
    expect(screen.getByText("From your crew")).toBeInTheDocument();
    expect(screen.getByText("How was your day?")).toBeInTheDocument();
  });

  it("renders the recap screen in Spanish", () => {
    render(<div>{marketingMockups.recap.render("es-ES")}</div>);
    expect(screen.getByText("De tu tripulación")).toBeInTheDocument();
  });

  /**
   * The silence: an illustration names nothing on its own. If a mockup ever
   * grew its own `role="img"`/`aria-label`, the caller's translated label
   * would be a second name for one picture — and the English one baked into
   * the component would never reach a Spanish reader.
   */
  it("gives an illustration no accessible name of its own", () => {
    const { container } = render(<div>{marketingMockups.recap.render("en-US")}</div>);
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });
});

describe("MarketingMockup", () => {
  it("takes its accessible name from the caller, verbatim", () => {
    const label = "The trip readiness section showing clear diver-ready and diver-blocked states.";
    render(
      <MarketingMockup label={label}>{marketingMockups.recap.render("en-US")}</MarketingMockup>,
    );
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });
});
