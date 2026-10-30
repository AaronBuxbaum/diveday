// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENU_PANEL, MENU_TICK_GUTTER } from "@/components/ui/menu";
import { SEGMENT_CORNER } from "@/components/ui/segmented";
import { LanguagePicker } from "./LanguagePicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CHOICES = [
  { locale: "en-US", label: "English (US)" },
  { locale: "es-ES", label: "Español" },
];

function openPicker(inHeader = false) {
  const picker = (
    <LanguagePicker
      current="es-ES"
      currentLabel="Español"
      choices={CHOICES}
      setLocale={vi.fn()}
      copy={{ ariaLabel: "Change language", heading: "Language" }}
    />
  );
  render(inHeader ? <header>{picker}</header> : picker);
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
  it("keeps a 44px square when the globe stands alone, its glyph centered in it", () => {
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

function mockPanel(triggerTop: number, panelHeight = 120) {
  let viewportHeight = 800;
  vi.spyOn(window, "innerHeight", "get").mockImplementation(() => viewportHeight);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(326, triggerTop, 44, 44),
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-language-menu")
      ? Math.min(panelHeight, Number.parseFloat(this.style.maxHeight) || panelHeight)
      : 44;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-language-menu") ? this.offsetHeight - 2 : 44;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-language-menu") ? panelHeight - 2 : 44;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(160);
  const resize = (height: number) => {
    viewportHeight = height;
    act(() => window.dispatchEvent(new Event("resize")));
  };
  return Object.assign(resize, {
    moveTrigger(top: number) {
      triggerTop = top;
    },
  });
}

describe("LanguagePicker viewport placement", () => {
  it("preserves the below-trigger placement when the full panel fits", async () => {
    mockPanel(200);
    const panel = await openPicker();
    expect(panel).toHaveAttribute("data-side", "below");
    expect(panel.style.top).toBe("48px");
    expect(panel.style.transformOrigin).toBe("top right");
  });

  it("flips above before paint when the lower side would clip it", async () => {
    mockPanel(700);
    const panel = await openPicker();
    expect(panel).toHaveAttribute("data-side", "above");
    expect(panel.style.top).toBe("-124px");
    expect(panel.style.transformOrigin).toBe("bottom right");
  });

  it("caps a longer list to the larger side and keeps its content scrollable", async () => {
    const resize = mockPanel(380, 1000);
    const panel = await openPicker();
    expect(panel).toHaveAttribute("data-side", "above");
    expect(panel.style.maxHeight).toBe("368px");
    expect(panel).toHaveClass("overflow-y-auto");
    resize(900);
    expect(panel).toHaveAttribute("data-side", "below");
    expect(panel.style.maxHeight).toBe("464px");
    resize(800);
    expect(panel).toHaveAttribute("data-side", "above");
    expect(panel.style.maxHeight).toBe("368px");
  });

  it("re-evaluates placement on resize and removes listeners when closed", async () => {
    const resize = mockPanel(700);
    resize(900);
    const remove = vi.spyOn(window, "removeEventListener");
    const panel = await openPicker();
    expect(panel).toHaveAttribute("data-side", "below");
    resize(800);
    expect(panel).toHaveAttribute("data-side", "above");
    cleanup();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
  });

  it("still dismisses with Escape and restores trigger focus", async () => {
    mockPanel(700);
    await openPicker();
    await userEvent.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: "Change language" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("keeps the picker open for pointerdowns inside its root", async () => {
    await openPicker();
    const trigger = screen.getByRole("button", { name: "Change language" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "English (US)" }));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("dismisses on an outside pointerdown and keeps the exit animation mounted", async () => {
    const panel = await openPicker();
    const trigger = screen.getByRole("button", { name: "Change language" });
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveClass("animate-scale-out");
    expect(panel).toBeInTheDocument();
  });

  it("observes panel and trigger changes and disconnects on unmount", async () => {
    mockPanel(700);
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    const panel = await openPicker();
    expect(observe).toHaveBeenCalledWith(panel);
    expect(observe).toHaveBeenCalledWith(screen.getByRole("button", { name: "Change language" }));
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("repositions when the enclosing header reflows without resizing the trigger", async () => {
    const geometry = mockPanel(600);
    const observed = new Set<Element>();
    let resizeHeader = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeHeader = () => {
            if ([...observed].some((element) => element.tagName === "HEADER")) callback();
          };
        }
        observe(element: Element) {
          observed.add(element);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
    const panel = await openPicker(true);
    expect(panel).toHaveAttribute("data-side", "below");
    geometry.moveTrigger(700);
    act(resizeHeader);
    expect(panel).toHaveAttribute("data-side", "above");
  });
});
