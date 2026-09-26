// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ManifestMoreMenu } from "./ManifestMoreMenu";

afterEach(cleanup);

function reference() {
  return (
    <div>
      <p>VHF 16 · +1-305-555-0116</p>
      <p>Shore contact · +1-305-555-0188</p>
      <p>Radio first. Oxygen next.</p>
    </div>
  );
}

describe("ManifestMoreMenu", () => {
  it("keeps the phone reference out of the resting manifest", () => {
    render(
      <ManifestMoreMenu
        variant="header"
        label="Emergency numbers & response plan"
        closeLabel="Close emergency reference"
      >
        {reference()}
      </ManifestMoreMenu>,
    );

    expect(
      screen.getByRole("button", { name: "Emergency numbers & response plan" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("VHF 16 · +1-305-555-0116")).not.toBeInTheDocument();
  });

  it("opens the same plain-text reference without a dial control", () => {
    render(
      <ManifestMoreMenu
        variant="header"
        label="Emergency numbers & response plan"
        closeLabel="Close emergency reference"
      >
        {reference()}
      </ManifestMoreMenu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Emergency numbers & response plan" }));
    expect(screen.getByText("VHF 16 · +1-305-555-0116")).toBeVisible();
    expect(screen.getByText("Shore contact · +1-305-555-0188")).toBeVisible();
    expect(screen.queryByRole("button", { name: /call|dial/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll('a[href^="tel:"]')).toHaveLength(0);
  });

  it("uses the quiet expandable footer treatment on desktop", () => {
    render(
      <ManifestMoreMenu
        variant="footer"
        label="Emergency numbers & response plan"
        closeLabel="Close emergency reference"
      >
        {reference()}
      </ManifestMoreMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Emergency numbers & response plan" });
    expect(trigger.parentElement?.className).toContain("lg:block");
    fireEvent.click(trigger);
    expect(screen.getByText("Radio first. Oxygen next.")).toBeVisible();
  });
});

describe("the footer line's place", () => {
  /**
   * **The footer line stands clear of the card above it** (pixel-craft class
   * 4, K-358). Its wrapper had no margin and the page passes none, so on a
   * desk the trigger's box began on the "On this phone" card's bottom border
   * (0px, where the page's other blocks sit 39–64px apart) and its 5px focus
   * ring drew inside the card. The wrapper keeps its own gap.
   */
  it("keeps a gap above the footer trigger", () => {
    render(
      <ManifestMoreMenu
        variant="footer"
        label="Emergency numbers & response plan"
        closeLabel="Close emergency reference"
      >
        {reference()}
      </ManifestMoreMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Emergency numbers & response plan" });
    expect(trigger.parentElement).toHaveClass("mt-3");
  });
});

describe("the menu's glyphs", () => {
  /**
   * **The ••• and the × are drawn at the text's size, not the button's**
   * (pixel-craft class 2, K-555). An `<svg>` with a `viewBox` and no size
   * stretches to its grid cell: the dots ran 34px across a 48px circle, 7px
   * from its border, and the × filled its button. `size-5` is the size
   * `DiverSheet` draws the same × at.
   */
  it("sizes the trigger's dots and the panel's close mark", () => {
    render(
      <ManifestMoreMenu
        variant="header"
        label="Emergency numbers & response plan"
        closeLabel="Close emergency reference"
      >
        {reference()}
      </ManifestMoreMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Emergency numbers & response plan" });
    expect(trigger.querySelector("svg")).toHaveClass("size-5");
    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "Close emergency reference" });
    expect(close.querySelector("svg")).toHaveClass("size-5");
  });
});

describe("the panel's close button", () => {
  /**
   * **A whole target** (pixel-craft class 7, principles.md §2). The phone
   * panel's × was `size-9`, a 36px circle on the surface a wet thumb reaches
   * for, under the 44px floor every other control on the manifest clears. It
   * is `size-11`, the person sheet's own close button.
   */
  it("gives the phone panel's close button the 44px floor", () => {
    render(
      <ManifestMoreMenu
        variant="header"
        label="Emergency numbers & response plan"
        closeLabel="Close emergency reference"
      >
        {reference()}
      </ManifestMoreMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Emergency numbers & response plan" }));
    const close = screen.getByRole("button", { name: "Close emergency reference" });
    expect(close).toHaveClass("size-11");
    expect(close).not.toHaveClass("size-9");
  });
});
