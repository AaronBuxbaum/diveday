// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChromeBar } from "./chrome/ChromeBar";
import { DemoBanner } from "./DemoBanner";

afterEach(cleanup);

const COPY = {
  shopLabel: "Demo shop",
  viewingAs: "Viendo como",
  switchRole: "Cambiar rol",
  sharedWarning: "",
  sessionExpired: "",
  withCredentials: "",
  active: "",
  tryLabel: "",
  current: "",
  switchAction: "",
  switchFailed: "",
};

const ROLES = [
  {
    id: "owner" as const,
    icon: "🏝️",
    name: "Dana Reyes",
    title: "Propietaria",
    desc: "",
    tryThis: "",
    switchAriaLabel: "",
  },
];

function renderBanner() {
  return render(
    <DemoBanner
      currentRole="owner"
      currentName="Dana Reyes"
      shopSlug="demo"
      roles={ROLES}
      copy={COPY}
      switchRole={async () => {}}
    />,
  );
}

/** The one class in a list that sets a max width, e.g. `max-w-6xl`. */
function maxWidthOf(element: Element | null): string | undefined {
  return [...(element?.classList ?? [])].find((token) => token.startsWith("max-w-"));
}

/**
 * The banner sits directly above the chrome bar on every demo page, so its
 * geometry is read against the bar's (docs/design/pixel-craft.md, classes 3,
 * 6 and 8).
 */
describe("DemoBanner", () => {
  it("keeps the viewer's name whole, with the space before it outside the unit", () => {
    // In Spanish "Viendo como Propietaria (Dana Reyes)" broke inside the
    // parentheses at 390px, leaving "Reyes)" alone on a second line.
    renderBanner();
    const name = screen.getByText("(Dana Reyes)");
    expect(name.textContent).toBe("(Dana Reyes)");
    expect(name).toHaveClass("whitespace-nowrap");
  });

  it("draws the shop label as a Badge pill, with no hand-rolled 6px corner anywhere in the banner", () => {
    const { container } = renderBanner();
    expect(screen.getByText("Demo shop")).toHaveClass("rounded-full");
    expect(container.querySelector(".rounded-md")).toBeNull();
  });

  it("lays its content on the chrome bar's row, not a narrower column", () => {
    // `max-w-4xl` under a `max-w-6xl` bar started the banner's text at x 216
    // at 1280, where the bar's own content and the page start at 88.
    const { container } = renderBanner();
    const bannerRow = container.firstElementChild?.firstElementChild ?? null;
    const { container: bar } = render(<ChromeBar leading={<span>Shop</span>} />);
    const barRow = bar.querySelector("header")?.firstElementChild ?? null;
    expect(maxWidthOf(barRow)).toBeDefined();
    expect(maxWidthOf(bannerRow)).toBe(maxWidthOf(barRow));
  });
});
