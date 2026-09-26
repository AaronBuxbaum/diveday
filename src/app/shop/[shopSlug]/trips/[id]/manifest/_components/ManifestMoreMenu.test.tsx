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
