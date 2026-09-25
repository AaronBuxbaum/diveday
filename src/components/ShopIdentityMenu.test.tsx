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
  settings: "Settings",
  language: "Language",
  signOut: "Sign out",
  signOutConfirm: "Sign out now?",
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
   * **Settings is the reason this menu is the shop's name** (ADR
   * 20260919-one-idea, slice 23b). It is the one place with no hour in it, so
   * the bar's three times have no pill for it and this is its door. It lived
   * here once and left when the nav's "More" groups arrived — a second door
   * would have been a duplicate control — and there is no nav now.
   */
  it("opens on Settings for a reader who may see it", async () => {
    render(
      <ShopIdentityMenu
        shopName="Blue Mantis Divers"
        settingsHref="/shop/blue-mantis/settings"
        signOutAction={vi.fn()}
        locale="en-US"
        languages={[{ locale: "en-US", label: "English (US)" }]}
        setLocaleAction={vi.fn()}
        copy={COPY}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Blue Mantis Divers/ }));
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings",
    );
  });

  it("is absent, not disabled, for a reader who may not open it", async () => {
    // The same rule every gated place follows (ADR
    // 20260724-role-gated-surfaces-hide-not-explain): a captain is not shown a
    // row that refuses them.
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
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
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
        settingsHref="/shop/blue-mantis/settings"
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
      screen.getByRole("link", { name: "Settings" }),
      screen.getByText("Language"),
      screen.getByRole("button", { name: "English (US)" }),
      screen.getByRole("button", { name: "Español" }),
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

  it("nests the panel's rows in its corner: a p-1 panel, and every row on the derived corner", async () => {
    const panel = await openMenu();
    for (const token of MENU_PANEL.split(" ")) expect(panel).toHaveClass(token);
    expect(panel).not.toHaveClass("p-2");
    const rows = [
      screen.getByRole("link", { name: "Settings" }),
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
