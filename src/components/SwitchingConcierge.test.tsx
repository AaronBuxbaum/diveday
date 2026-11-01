// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SwitchingConcierge } from "./SwitchingConcierge";

afterEach(cleanup);

/**
 * One way to ask for a shop (2026-10-22): the offer's door is the set-up form,
 * carrying the page's concierge tag, where it was a mail link.
 */
describe("the concierge's door", () => {
  it("opens the set-up form with the page's tag, and no mail link", () => {
    const { container } = render(
      <SwitchingConcierge locale="en-US" source="switching-eve-concierge" />,
    );
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/get-set-up?from=switching-eve-concierge",
    ]);
    expect(links[0]).toHaveTextContent("Get set up");
  });
});
