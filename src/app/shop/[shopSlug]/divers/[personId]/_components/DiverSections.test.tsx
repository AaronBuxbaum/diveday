// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JumpNav } from "@/components/JumpNav";
import { staffTranslator } from "@/i18n/staff-messages";
import { DIVER_SECTIONS, DiverSection } from "./DiverSections";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** The row exactly as the diver record builds it. */
function renderNav() {
  return render(
    <JumpNav
      ariaLabel={t("divers.subNav.ariaLabel")}
      items={DIVER_SECTIONS.map((section) => ({ id: section.id, label: t(section.labelKey) }))}
    />,
  );
}

describe("the diver record's jump row", () => {
  it("is a labelled navigation landmark", () => {
    renderNav();
    expect(screen.getByRole("navigation", { name: "Diver record" })).toBeInTheDocument();
  });

  it("links to each section in page order", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Diver record" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["#cards", "#fit", "#payments", "#trips", "#history"]);
  });

  it("labels each link from the staff bundle", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Diver record" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Cards", "Fit", "Payments", "Trips", "History"]);
  });

  /**
   * Payments used to sit seventh, roughly 4,500px down a 6,400px phone page,
   * below "Book an activity". A diver at the counter with a bill outranks one
   * browsing next week's boats, so the row — and the page — puts money first.
   */
  it("offers Payments before Trips", () => {
    const ids = DIVER_SECTIONS.map((section) => section.id);
    expect(ids.indexOf("payments")).toBeLessThan(ids.indexOf("trips"));
  });

  /**
   * Removing a diver and erasing their personal and medical data are the
   * destructive tail of the page (ADR 20260802-diver-data-erasure). Reaching
   * them costs a deliberate scroll; the row must never grow a one-tap jump.
   */
  it("does not offer the destructive tail", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Diver record" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("#remove");
    expect(hrefs).not.toContain("#erase");
  });
});

describe("DiverSection", () => {
  it("gives the row an anchor target that clears the sticky header", () => {
    const { container } = render(
      <DiverSection id="payments">
        <p>rows</p>
      </DiverSection>,
    );
    const target = container.querySelector("#payments");
    expect(target).toBeInTheDocument();
    expect(target).toHaveClass("scroll-mt-24");
  });
});
