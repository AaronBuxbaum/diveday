// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ForgotPasswordLoading from "./loading";

afterEach(cleanup);

/**
 * **The skeleton wears the page's chrome** (docs/design/pixel-craft.md, class
 * 11; K-291). The page draws `MarketingNav` and `MarketingFooter` around its
 * door, and the skeleton drew the door alone, so it centred the panel in the
 * whole viewport and the panel jumped into the band the header and footer
 * leave when the page landed. The chrome is the real signed-out,
 * default-locale header and footer, as `/dive`'s skeleton draws it.
 */
describe("the forgot-password skeleton", () => {
  it("draws the header and the footer around the door", () => {
    const { container } = render(<ForgotPasswordLoading />);
    const banner = screen.getByRole("banner");
    const main = screen.getByRole("main");
    const footer = screen.getByRole("contentinfo");
    expect(container.firstElementChild).toHaveClass("flex", "flex-1", "flex-col");
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still draws the one-field door between them", () => {
    render(<ForgotPasswordLoading />);
    const main = screen.getByRole("main");
    expect(main.querySelectorAll(".h-11")).toHaveLength(1);
    expect(main.querySelectorAll(".h-12")).toHaveLength(1);
  });
});
