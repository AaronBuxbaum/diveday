// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENU_PANEL, MENU_TICK, MENU_TICK_GUTTER } from "@/components/ui/menu";
import { SEGMENT_CORNER } from "@/components/ui/segmented";
import { ShopIdentityMenu, shopInitials } from "./ShopIdentityMenu";

afterEach(() => {
  cleanup();
});

const COPY = {
  calendar: "Calendar subscription",
  language: "Language",
  signOut: "Sign out",
  signOutConfirm: "Sign out now?",
  boatMode: "Boat mode",
  signOutPending: "Signing out…",
};

describe("shopInitials", () => {
  it("derives two letters from a multi-word shop name", () => {
    expect(shopInitials("Blue Mantis Divers")).toBe("BM");
    expect(shopInitials("Key Largo Dive Center")).toBe("KL");
  });

  it("derives first two characters from a single-word shop name", () => {
    expect(shopInitials("Oasis")).toBe("OA");
  });

  it("falls back to DD for empty name", () => {
    expect(shopInitials("")).toBe("DD");
    expect(shopInitials("   ")).toBe("DD");
  });
});

describe("ShopIdentityMenu", () => {
  it("renders shop initials in primary square when logoUrl is absent", () => {
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    expect(screen.getByText("BM")).toBeInTheDocument();
    expect(screen.getByText("Blue Mantis Divers")).toBeInTheDocument();
  });

  it("renders custom logo image when logoUrl is provided", () => {
    const { container } = render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        logoUrl="https://blob.example/logo.webp"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://blob.example/logo.webp");
    expect(screen.queryByText("BM")).toBeNull();
  });

  /**
   * **The reader's own calendar feed leads this menu** (ADR 20261001-logbook).
   * Settings has its own row in the nav now, so a second door here would be a
   * duplicate control; what stays is about this reader, not the shop.
   */
  it("opens on the reader's calendar subscription", async () => {
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        calendarHref="/shop/blue-mantis/settings/calendar"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Blue Mantis Divers/ }));
    expect(screen.getByRole("link", { name: "Calendar subscription" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings/calendar",
    );
  });

  it("leaves the reader's own half of the menu when no link leads it", async () => {
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Blue Mantis Divers/ }));
    expect(screen.queryByRole("link", { name: "Calendar subscription" })).toBeNull();
    // …and the reader's own half of the menu is still there.
    expect(screen.getByText("Language")).toBeInTheDocument();
  });
});

/**
 * **One panel, one corner, one text edge** (pixel-craft.md, classes 3 and 6).
 * The panel was `rounded-inset … p-2` with `rounded-lg` rows, a 12px fill 9px
 * inside a 12px corner: the probe's `fill-corners` flag on Settings and Sign
 * out in `identity-menu-open`. And the words started at three edges, measured
 * from the panel's padding box: the LANGUAGE label at 16px, Settings and Sign
 * out at 20px, the language names at 40px behind their tick column.
 *
 * jsdom lays nothing out, so these pin which element carries which part of
 * the recipe, and what is absent. `menu.test.ts` pins what the parts add up
 * to, and the integration stage's probe measures the rendered result.
 */
describe("ShopIdentityMenu — the open panel", () => {
  const LANGUAGES = [
    { locale: "en-US", label: "English (US)" },
    { locale: "es-ES", label: "Español" },
  ];

  async function openMenu() {
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        calendarHref="/shop/blue-mantis/settings/calendar"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={LANGUAGES}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Blue Mantis Divers/ });
    await userEvent.click(trigger);
    return trigger.nextElementSibling as HTMLElement;
  }

  const horizontalPadding = (element: Element) =>
    [...element.classList].filter((token) => /^(p|px|pl|pr|ps|pe)-/.test(token));

  it("puts Settings, the LANGUAGE label, both languages and Sign out on the tick gutter and no other inset", async () => {
    await openMenu();
    const starts = [
      screen.getByRole("link", { name: "Calendar subscription" }),
      screen.getByText("Language"),
      screen.getByRole("button", { name: "English (US)" }),
      screen.getByRole("button", { name: "Español" }),
      screen.getByRole("button", { name: "Boat mode" }),
      screen.getByRole("button", { name: "Sign out" }),
    ];
    for (const element of starts) {
      expect(horizontalPadding(element).sort(), element.textContent ?? "").toEqual(
        MENU_TICK_GUTTER.split(" ").sort(),
      );
    }
  });

  it("draws a tick only in the gutter of the language in force, out of its words' flow", async () => {
    const panel = await openMenu();
    const current = screen.getByRole("button", { name: "English (US)" });
    expect(current).toHaveAttribute("aria-current", "true");
    const ticks = panel.querySelectorAll("svg");
    expect(ticks).toHaveLength(1);
    const tick = ticks[0].parentElement as HTMLElement;
    expect(current).toContainElement(tick);
    expect(tick).toHaveAttribute("aria-hidden", "true");
    for (const token of MENU_TICK.split(" ")) expect(tick).toHaveClass(token);
    // No inert placeholder is left in the other rows to hold their edge: the
    // gutter holds it.
    expect(screen.getByRole("button", { name: "Español" }).children).toHaveLength(0);
  });

  it("switches this device into Boat mode and back, ticking the row while it is on", async () => {
    await openMenu();
    const row = screen.getByRole("button", { name: "Boat mode" });
    expect(row).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveClass("boat-mode");
    expect(row.querySelector("svg")).not.toBeNull();
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).not.toHaveClass("boat-mode");
  });

  it("nests the panel's rows in its corner: a p-1 panel, and every row on the derived corner", async () => {
    const panel = await openMenu();
    for (const token of MENU_PANEL.split(" ")) expect(panel).toHaveClass(token);
    expect(panel).not.toHaveClass("p-2");
    const rows = [
      screen.getByRole("link", { name: "Calendar subscription" }),
      screen.getByRole("button", { name: "English (US)" }),
      screen.getByRole("button", { name: "Español" }),
      screen.getByRole("button", { name: "Sign out" }),
    ];
    for (const row of rows) {
      expect(row, row.textContent ?? "").toHaveClass(SEGMENT_CORNER);
      expect(row, row.textContent ?? "").not.toHaveClass("rounded-lg");
    }
  });

  it("keeps Sign out's words on the gutter once armed, warning with a ring rather than a border", async () => {
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const armed = screen.getByRole("button", { name: "Sign out now?" });
    expect(horizontalPadding(armed).sort()).toEqual(MENU_TICK_GUTTER.split(" ").sort());
    expect(armed).toHaveClass("ring-inset", "text-danger", SEGMENT_CORNER);
    expect([...armed.classList].filter((token) => /^border/.test(token))).toEqual([]);
  });
});

/**
 * The shop's name is the bar's one control with no radius and no hover: its
 * focus ring came out square beside rounded siblings (the pixel audit,
 * cda2d480), and a pointer over it changed nothing. And when the name folds
 * away on scroll, the button shrank to exactly the 36px mark, so the page's
 * title landed 1px from the mark and the menu's door was under a target.
 */
describe("the identity trigger", () => {
  function trigger() {
    const { container } = render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );
    return container.querySelector("[data-identity-menu]") as HTMLElement;
  }

  it("rounds its ring and its hover fill like the bar's other controls", () => {
    expect(trigger()).toHaveClass("rounded-lg", "hover:bg-surface-sunken");
  });

  /**
   * 8px of fill round the mark, handed back at the start so the mark stays on
   * the bar's gutter. Not at the end below `lg`: when the name folds, the
   * page's title lands where this box ends, and the end padding is what puts
   * it 8px past the mark — where the unfolded name's first letter sits. A
   * negative end margin there would pull the title back onto the mark.
   *
   * From `lg` up the bar never folds (globals.css scopes the fold to
   * `width < 64rem`), and the end padding only widened the leading slot: the
   * start-aligned Today/Week/Season pills moved 8px right on every staff page,
   * 20px from the caret where they stood 12px. So from `lg` it is handed back
   * too, and the pills stand where they stood.
   */
  it("gives the fill 8px of room without moving the mark, the folded title, or the pills", () => {
    const button = trigger();
    expect(button).toHaveClass("-ms-2", "px-2", "lg:-me-2");
    expect(button).not.toHaveClass("-mx-2");
    expect(button).not.toHaveClass("-me-2");
  });

  it("never folds to less than a 44px target", () => {
    const button = trigger();
    expect(button).toHaveClass("min-w-11", "min-h-11");
    expect(button).not.toHaveClass("min-w-0");
  });
});
