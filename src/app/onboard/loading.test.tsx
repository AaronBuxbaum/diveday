// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import OnboardLoading from "./loading";

afterEach(cleanup);

/**
 * **The skeleton is the door the route renders by default** (docs/design/
 * pixel-craft.md, class 11; K-290). Without a setup key `/onboard` renders
 * `ClosedDoor`: the marketing header, one sentence and one mail button in a
 * panel, two footer lines and the marketing footer. The skeleton drew a
 * six-field form and no chrome, about 440px taller than the door, centred in
 * the whole viewport, and it collapsed into the closed door on every visit.
 */
describe("the /onboard skeleton", () => {
  it("draws the marketing header and footer around the door", () => {
    render(<OnboardLoading />);
    const banner = screen.getByRole("banner");
    const main = screen.getByRole("main");
    const footer = screen.getByRole("contentinfo");
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws one button and no fields, as the closed door has", () => {
    render(<OnboardLoading />);
    const main = screen.getByRole("main");
    expect(main.querySelectorAll(".h-11")).toHaveLength(0);
    expect(main.querySelectorAll(".h-12")).toHaveLength(1);
  });

  it("stands in the closed door's column, not the form's", () => {
    render(<OnboardLoading />);
    expect(screen.getByRole("main")).toHaveClass("max-w-md");
  });
});
