// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
  marketingMockups,
} from "./MarketingSections";

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
    // captain calls the roll, the diver goes home with something worth
    // sending on. The evening entry landed 2026-08-28
    // (docs/product/marketing-review-20260827.md); the dock entry on
    // 2026-09-24, when the band became four annotated screens (H-89) and the
    // roll call the hero already showed became a screen of its own.
    expect(Object.keys(marketingMockups)).toEqual([
      "diverBooking",
      "frontDeskReadiness",
      "captainRollCall",
      "recap",
    ]);
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

  it("draws a page's screenshot as a panel: the panel corner and one hairline", () => {
    render(<MarketingMockup label="A screen">{null}</MarketingMockup>);
    expect(screen.getByRole("img", { name: "A screen" })).toHaveClass(
      "rounded-panel",
      "border",
      "border-border",
    );
  });
});

/**
 * The screen inside the phone bezel. The frame used to ask for its corner by
 * passing a second radius utility through `className`, beside the mockup's own
 * `rounded-panel`; Tailwind emits one property's utilities in its own order,
 * the panel rung won, and a 20px screen corner sat inside a 40px bezel where it
 * nests at 25 (docs/design/pixel-craft.md, class 6). The corner is now the
 * mockup's own choice, so no utility is left to lose.
 */
describe("CaptainPhoneFrame", () => {
  it("rounds the screen concentric with the bezel, and draws no hairline inside it", () => {
    render(<CaptainPhoneFrame label="The roll call on a phone" locale="en-US" />);
    const screenBox = screen.getByRole("img", { name: "The roll call on a phone" });
    // 40px bezel corner (`rounded-[2.5rem]`) − 9px frame − 6px `p-1.5` = 25px.
    expect(screenBox).toHaveClass("rounded-[25px]");
    expect(screenBox).not.toHaveClass("rounded-panel");
    // Nothing to cancel either: the bezel is the screen's edge.
    expect(screenBox).not.toHaveClass("border");
    expect(screenBox).not.toHaveClass("border-0");
    expect(screenBox).not.toHaveClass("rounded-[1.9rem]");
  });
});

describe("FeatureGroupsGrid", () => {
  it("balances every group heading, so none ends on one word", () => {
    render(<FeatureGroupsGrid locale="en-US" />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      expect(heading, heading.textContent ?? "").toHaveClass("text-balance");
    }
  });
});
