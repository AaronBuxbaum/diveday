// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sectionCardClass } from "@/components/ui/card";
import { rendersFlush } from "@/test/button-flush";
import { YoursGroup } from "./YoursGroup";

vi.mock("@/app/actions/shelf-door", () => ({ openMyShelfAction: vi.fn() }));

afterEach(cleanup);

function renderGroup() {
  return render(
    <YoursGroup
      heading="Yours"
      greeting="Welcome back, Priya. Tonight’s your 21st."
      rows={[
        {
          id: "trip-1",
          href: "/s/blue-mantis/trips/trip-1",
          title: "Night Dive — City of Washington",
          when: "Tonight, 7:30 PM",
          because: null,
        },
      ]}
      shopSlug="blue-mantis"
      shelfLabel="Your shelf"
    />,
  );
}

/**
 * **The card is the page's card** (pixel-craft class 12). It sits directly
 * under the storefront's status panels and hand-rolled their shell: a 12px
 * corner against their 20px, no bed shadow, and its words 24px in against
 * their 20px at 1280.
 */
describe("the Yours card", () => {
  it("wears the card shell the panels above it do", () => {
    renderGroup();

    const card = screen.getByRole("region", { name: "Yours" });
    expect(card.className).toBe(sectionCardClass({ className: "mt-8" }));
  });
});

/**
 * **The shelf's door starts on the column the rows do** (pixel-craft class 3).
 * It was a `link` button at its size's padding, so "Your shelf" started 16px
 * right of the "Yours" heading and the row titles above it: x 129 against 113
 * at 1280, 49 against 33 at 390.
 */
describe("the shelf's door", () => {
  it("drops its padding, so its words sit on the group's column", () => {
    renderGroup();

    const door = screen.getByRole("button", { name: "Your shelf" });
    expect(rendersFlush(door, "link", "md")).toBe(true);
  });
});
