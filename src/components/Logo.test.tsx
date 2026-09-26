// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Wordmark } from "./Logo";

afterEach(cleanup);

/**
 * The header's way home was a 95×24px link with a square focus ring beside
 * 44px nav links and a 48px CTA (K-32). The linked lockup is a target, so it
 * takes the CTA's 48px floor and the control radius; that floor is also what
 * holds the marketing header's first row at one height when `hideCta` drops
 * the CTA (K-178).
 */
describe("Wordmark", () => {
  it("is a 48px target with the control radius when it links home", () => {
    render(<Wordmark href="/" />);
    const link = screen.getByRole("link", { name: "DiveDay." });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveClass("min-h-12", "rounded-lg");
  });

  it("stays a plain line of text when it does not link", () => {
    const { container } = render(<Wordmark variant="inline"> A tagline.</Wordmark>);
    const line = container.querySelector("p");
    expect(line).not.toBeNull();
    expect(line).not.toHaveClass("min-h-12");
    expect(line).not.toHaveClass("rounded-lg");
  });
});
