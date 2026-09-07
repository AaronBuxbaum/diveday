// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoldedPageTitle } from "./FoldedPageTitle";

/**
 * The portal that carries a page's title into the shell's bar (ADR
 * 20260907-nothing-from-nowhere, decision 5). Two things have to hold, and
 * neither is visible in a screenshot: it must reach the staff bar's slot, and
 * it must not reach anything on the storefront, which shares this header and
 * does not fold.
 */

const withSlot = () => {
  const slot = document.createElement("span");
  slot.setAttribute("data-chrome-title-slot", "");
  slot.setAttribute("aria-hidden", "true");
  document.body.append(slot);
  return slot;
};

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("FoldedPageTitle", () => {
  it("delivers the title into the bar's slot", () => {
    const slot = withSlot();
    render(<FoldedPageTitle title="Check-in" />);
    expect(slot.textContent).toBe("Check-in");
  });

  /**
   * **The storefront's gate is the slot's absence**, and it is deliberate
   * rather than a thing that happens to be true: `ShopPageHeader` serves
   * ten-plus surfaces under `src/app/s/`, and the ADR says the public
   * storefront keeps its header and does not fold.
   */
  it("renders nothing at all where there is no slot", () => {
    const { container } = render(<FoldedPageTitle title="Two-Tank Reef" />);
    expect(container).toBeEmptyDOMElement();
    expect(document.body.textContent).toBe("");
  });

  /**
   * The label is a second copy of a heading the page already renders, so a
   * screen reader must not meet the words twice — and the bar's own accessible
   * name has to stay the shop's. The slot carries `aria-hidden`; this pins that
   * the title lands *inside* it rather than beside it.
   */
  it("lands inside the hidden slot, leaving one announced copy of the words", () => {
    const slot = withSlot();
    render(
      <>
        <h1>Divers</h1>
        <FoldedPageTitle title="Divers" />
      </>,
    );
    expect(slot.textContent).toBe("Divers");
    // The page's heading is still the only *exposed* "Divers": the label goes
    // into the slot rather than beside it, and the slot is hidden. The slot's
    // own `aria-hidden` belongs to `ShopNav`, and `chrome.test.ts` pins it
    // there — this asserts the half that is this component's, which is that
    // the words never land outside it.
    expect(screen.getAllByRole("heading", { name: "Divers" })).toHaveLength(1);
    expect(screen.queryAllByText("Divers", { ignore: "[aria-hidden='true']" })).toHaveLength(1);
  });
});
