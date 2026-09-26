// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENU_PANEL, MENU_TICK_GUTTER } from "@/components/ui/menu";
import { SEGMENT_CORNER } from "@/components/ui/segmented";
import { LanguagePicker } from "./LanguagePicker";

afterEach(cleanup);

const CHOICES = [
  { locale: "en-US", label: "English (US)" },
  { locale: "es-ES", label: "Español" },
];

function openPicker() {
  render(
    <LanguagePicker
      current="es-ES"
      currentLabel="Español"
      choices={CHOICES}
      setLocale={vi.fn()}
      copy={{ ariaLabel: "Change language", heading: "Language" }}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Change language" });
  return userEvent.click(trigger).then(() => trigger.nextElementSibling as HTMLElement);
}

const horizontalPadding = (element: Element) =>
  [...element.classList].filter((token) => /^(p|px|pl|pr|ps|pe)-/.test(token)).sort();

/**
 * The closed control is a 44px target at every width (docs/design/
 * pixel-craft.md, class 7). Below `sm` the endonym goes `sr-only` and the
 * globe carries the control alone, which left a 28×44 button — the size of
 * the globe and its padding — in every shopfront's phone header.
 */
describe("LanguagePicker — the closed control", () => {
  it("keeps a 44px square when the globe stands alone, its glyph centred in it", () => {
    render(
      <LanguagePicker
        current="es-ES"
        currentLabel="Español"
        choices={CHOICES}
        setLocale={vi.fn()}
        copy={{ ariaLabel: "Change language", heading: "Language" }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Change language" });
    expect(trigger).toHaveClass("min-h-11", "min-w-11", "justify-center");
  });
});

/**
 * The public header's language picker is the other panel that lists
 * `LanguageChoices`, so it takes the same recipe as the staff identity menu
 * (pixel-craft.md, classes 3 and 6). Its heading sat at `px-2`, 24px left of
 * the names behind their tick column, and its `rounded-lg` rows sat 9px
 * inside a 12px corner. jsdom lays nothing out, so this pins which element
 * carries which part of the recipe. `menu.test.ts` pins what the parts add up
 * to.
 */
describe("LanguagePicker — the open panel", () => {
  it("starts the heading and every language on the one tick gutter", async () => {
    await openPicker();
    const starts = [
      screen.getByText("Language"),
      screen.getByRole("button", { name: "English (US)" }),
      screen.getByRole("button", { name: "Español" }),
    ];
    for (const element of starts) {
      expect(horizontalPadding(element), element.textContent ?? "").toEqual(
        MENU_TICK_GUTTER.split(" ").sort(),
      );
    }
  });

  it("is the shared p-1 menu panel, with every language row on the derived corner", async () => {
    const panel = await openPicker();
    for (const token of MENU_PANEL.split(" ")) expect(panel).toHaveClass(token);
    expect(panel).not.toHaveClass("p-2");
    for (const name of ["English (US)", "Español"]) {
      const row = screen.getByRole("button", { name });
      expect(row, name).toHaveClass(SEGMENT_CORNER);
      expect(row, name).not.toHaveClass("rounded-lg");
    }
  });

  it("marks the language in force with aria-current and the one tick", async () => {
    const panel = await openPicker();
    expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "English (US)" })).not.toHaveAttribute(
      "aria-current",
    );
    const ticks = panel.querySelectorAll("svg");
    expect(ticks).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Español" })).toContainElement(
      ticks[0] as unknown as HTMLElement,
    );
  });
});
