// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalkTyped } from "@/components/WalkTyped";
import { staffTranslator } from "@/i18n/staff-messages";
import { STAGE_WORD_KEYS } from "@/lib/trip-stages";
import {
  CheckoutFallback,
  RegisterFallback,
  SeatPickFallback,
} from "./MarketingBookingWalkScreens";
import {
  CaptainRollCallFallback,
  ExportBundleFallback,
  FrontDeskReadinessFallback,
  ImportPreviewFallback,
  NightBeforeBriefFallback,
  RecapPageFallback,
} from "./MarketingScreenFallbacks";

afterEach(cleanup);

it.each([
  ["en-US", "Email (optional)", "Card number (optional)"],
  ["es-ES", "Correo electrónico (opcional)", "Número de tarjeta (opcional)"],
] as const)("RegisterFallback marks optional fields in %s", (locale, email, card) => {
  render(<RegisterFallback locale={locale} />);
  expect(screen.getByText(email)).toBeVisible();
  expect(screen.getByText(card)).toBeVisible();
});

it("RecapPageFallback shows the dive log entry, then the trip's photos, then three species seen", () => {
  const { container } = render(<RecapPageFallback locale="en-US" />);
  const text = container.textContent ?? "";
  expect(text.indexOf("Dive log entry")).toBeGreaterThan(-1);
  expect(text.indexOf("Photos from the trip")).toBeGreaterThan(text.indexOf("Dive log entry"));
  expect(text.indexOf("Seen on your dive")).toBeGreaterThan(text.indexOf("Photos from the trip"));
  expect(container.querySelectorAll("ul img")).toHaveLength(3);
});

it("RecapPageFallback's review has her typing a glowing review before she sends it", () => {
  const { container } = render(<RecapPageFallback locale="en-US" view="review" state="writing" />);
  expect(container.querySelector("[data-walk-type]")).not.toBeNull();
  expect(container.querySelector("[data-tap-target]")?.textContent).toBe("Leave my review");
});

const EVERY_MOCK = [
  ["CaptainRollCallFallback", CaptainRollCallFallback],
  ["FrontDeskReadinessFallback", FrontDeskReadinessFallback],
  ["ImportPreviewFallback", ImportPreviewFallback],
  ["ExportBundleFallback", ExportBundleFallback],
  ["RecapPageFallback", RecapPageFallback],
  [
    "RecapPageFallback (review)",
    ({ locale }: { locale: "en-US" | "es-ES" }) => (
      <RecapPageFallback locale={locale} view="review" />
    ),
  ],
  ["NightBeforeBriefFallback", NightBeforeBriefFallback],
  ["SeatPickFallback", SeatPickFallback],
  ["CheckoutFallback", CheckoutFallback],
  ["RegisterFallback", RegisterFallback],
] as const;

/** A mock's two parts: its app bar and the body under it. */
function barAndBody(Mock: (typeof EVERY_MOCK)[number][1]) {
  const { container } = render(<Mock locale="en-US" />);
  const [bar, body] = Array.from(container.firstElementChild?.children ?? []);
  return { bar, body };
}

/** The one horizontal inset an element's padding classes give it, in Tailwind steps. */
function insetOf(element: Element) {
  const steps = element.className
    .split(/\s+/)
    .map((token) => /^p[x]?-(\d+(?:\.\d+)?)$/.exec(token)?.[1])
    .filter(Boolean);
  expect(steps).toHaveLength(1);
  return steps[0];
}

/**
 * The silence: an illustration names nothing on its own. A page frames it in
 * `MarketingMockup`, whose `aria-label` the page resolves from its own bundle;
 * a mock that grew its own `role="img"` or `aria-label` would give one picture
 * a second name, and the English one baked into the component would never
 * reach a Spanish reader.
 */
describe("the mocks' accessible names", () => {
  it.each(EVERY_MOCK)("%s gives itself none", (_name, Mock) => {
    const { container } = render(<Mock locale="en-US" />);
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });
});

/**
 * The bar's label sat 16px in over bodies inset 20px, so the shop name and the
 * body's eyebrow missed each other by 4px on the seven card mocks (K-51). Bar
 * and body share one edge in every mock: 20px in the cards, and 16px in the
 * roll call, the phone screen, which was already 16 over 16. At 20px its app
 * bar broke onto two lines in the landing hero's phone at 390, and es-ES's
 * "EMBARCADOS" (69.3px) outgrew its stat tile's 67.3px label box.
 */
describe("the mock family's inset", () => {
  it.each(EVERY_MOCK)("%s starts its bar and its body on one edge", (_name, Mock) => {
    const { bar, body } = barAndBody(Mock);
    expect(insetOf(bar)).toBe(insetOf(body));
  });

  it.each(EVERY_MOCK.filter(([name]) => name !== "CaptainRollCallFallback"))(
    "%s, a card, is inset 20px",
    (_name, Mock) => {
      const { bar, body } = barAndBody(Mock);
      expect(insetOf(bar)).toBe("5");
      expect(insetOf(body)).toBe("5");
    },
  );

  it("insets the roll call, a phone screen, 16px", () => {
    const { bar, body } = barAndBody(CaptainRollCallFallback);
    expect(insetOf(bar)).toBe("4");
    expect(insetOf(body)).toBe("4");
  });

  // In /about's 290px phone screen both halves of the bar wrapped inside
  // themselves: "BLUE MANTIS / DIVERS" beside "Offline copy · up to / date"
  // (K-398). Each half is one unit; when the pair does not fit on one line the
  // label moves under the name whole. Not `truncate`: an ellipsis there would
  // cut "up to date", which is the half of the label that says anything. The
  // gap is only the floor between the two when they share a line; a 12px one
  // broke the landing hero's phone bar at 390 (135 + 136 in 280), which had
  // stood on one line with 9px between them.
  it.each(EVERY_MOCK)("%s never splits the shop name or the bar's label", (_name, Mock) => {
    const { bar } = barAndBody(Mock);
    expect(bar).toHaveClass("flex-wrap", "justify-between", "gap-x-1.5");
    const [name, label] = Array.from(bar.children);
    expect(name).toHaveClass("whitespace-nowrap");
    expect(label).toHaveClass("whitespace-nowrap");
    expect(label).not.toHaveClass("truncate");
  });
});

/**
 * "Mark boarded" and "Download" were 44px and the recap 's "Leave my review"
 * 40px, off the button ladder, with the class string otherwise identical
 * (K-516). One drawn primary button, at the `sm` rung's 44px, and its bordered
 * twin ("Send waiver") on the same rung. The roll call draws no button at all
 * now: its tap is the circle (UX audit #6).
 */
describe("the mocks' primary button", () => {
  const everyButton = () =>
    EVERY_MOCK.flatMap(([, Mock]) => {
      const { container, unmount } = render(<Mock locale="en-US" />);
      const found = Array.from(container.querySelectorAll("button"));
      const classes = found.map((button) => button.className);
      unmount();
      return classes;
    });

  it("draws every button on the 44px rung", () => {
    for (const className of everyButton()) {
      const tokens = className.split(/\s+/);
      expect(tokens).toEqual(expect.arrayContaining(["min-h-11", "rounded-lg", "text-xs"]));
      expect(tokens).not.toContain("min-h-10");
    }
  });

  it("is one 44px button in every mock that draws one", () => {
    const buttons = everyButton().filter((className) =>
      className.split(/\s+/).includes("bg-primary"),
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const className of buttons) {
      const tokens = className.split(/\s+/);
      expect(tokens).toEqual(
        expect.arrayContaining([
          "inline-flex",
          "min-h-11",
          "items-center",
          "justify-center",
          "rounded-lg",
          "bg-primary",
          "px-3",
          "text-xs",
          "font-semibold",
          "text-primary-foreground",
        ]),
      );
      expect(tokens).not.toContain("min-h-10");
    }
  });
});

/**
 * "Crew assigned (Mateo & Sarah)" wrapped to leave "Sarah)" alone under it at
 * 390 on /product, with the badge pressed against the label (K-578). The two
 * checklist mocks draw one row: a label that wraps without a one-word last
 * line and gives way to a badge that never shrinks, 8px apart — at 12px the
 * gap took the 3px "Tanks analyzed & loaded" needed to stay on one line.
 */
describe("the mocks' checklist rows", () => {
  it.each([
    ["NightBeforeBriefFallback", NightBeforeBriefFallback, "Gear and setup"],
    ["NightBeforeBriefFallback", NightBeforeBriefFallback, "Waiver"],
  ] as const)("%s wraps a long label cleanly beside its badge", (_name, Mock, text) => {
    render(<Mock locale="en-US" />);
    const label = screen.getByText(text);
    expect(label).toHaveClass("min-w-0", "text-pretty");
    const row = label.parentElement;
    expect(row).toHaveClass("gap-2");
    expect(label.nextElementSibling).toHaveClass("shrink-0");
  });
});

describe("MarketingScreenFallbacks", () => {
  // Each mock mirrors one real screen element for element, and the notes beside
  // it quote that screen's words (docs/design/brand.md, "The builder's note").
  // These pin the words the notes quote.
  describe("FrontDeskReadinessFallback, Today drawn small", () => {
    it("draws a departure's readiness and two Needs you rows", () => {
      render(<FrontDeskReadinessFallback locale="en-US" />);
      expect(screen.getByText("7 of 9 ready")).toBeInTheDocument();
      expect(screen.getByText("2 blocked")).toBeInTheDocument();
      expect(screen.getByText("Needs you")).toBeInTheDocument();
      expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
      expect(screen.getByText("Nudge waiver")).toBeInTheDocument();
      // There is no button that clears everyone (the home note says so).
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });

    // The walkthrough follows Priya: her waiver row is there until she signs, and the
    // morning after she has, the list is one row shorter and one diver more ready.
    it("moves Priya from an open waiver to ready", () => {
      const { rerender } = render(<FrontDeskReadinessFallback locale="en-US" state="unsigned" />);
      expect(screen.getByText("Waiver not signed, link sent")).toBeInTheDocument();
      expect(screen.getByText("7 of 9 ready")).toBeInTheDocument();
      rerender(<FrontDeskReadinessFallback locale="en-US" state="ready" />);
      // Her row is on the finished screen only as the collapsed one the walk closes (`walk-shrink`).
      expect(screen.getByText("Priya Sharma").closest("li")).toHaveClass("walk-shrink");
      expect(screen.getByText("8 of 9 ready")).toBeInTheDocument();
      expect(screen.getByText("1 blocked")).toBeInTheDocument();
      expect(screen.getByText("Diego Alvarez")).toBeInTheDocument();
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    it("renders in Spanish", () => {
      render(<FrontDeskReadinessFallback locale="es-ES" />);
      expect(screen.getByText("Pendiente")).toBeInTheDocument();
      expect(screen.getByText("Recordar exención")).toBeInTheDocument();
    });
  });

  /**
   * UX audit #6: the selling screen is the shipped roll call, light by day,
   * one circle tap per name, never the side-by-side button pair of the boat
   * mode's saved copy it used to draw.
   */
  describe("CaptainRollCallFallback, the live roll call", () => {
    it("draws the dock checkpoint light, with the head count and a circle per name", () => {
      const { container } = render(<CaptainRollCallFallback locale="en-US" />);
      expect(container.firstElementChild).not.toHaveClass("boat-mode");
      expect(screen.getByText("of 9 divers aboard")).toBeInTheDocument();
      expect(screen.getByText("Before departure roll call")).toBeInTheDocument();
      expect(screen.getByText("Dock")).toBeInTheDocument();
      // The real mark: 56px circles, one aboard (filled) and one still to call.
      const marks = container.querySelectorAll("span.size-14.rounded-full");
      expect(marks).toHaveLength(2);
      expect(marks[0]).toHaveClass("bg-success");
      expect(marks[1]).toHaveClass("bg-surface");
      // No button pair: the tap is the circle.
      expect(container.querySelectorAll("button")).toHaveLength(0);
      expect(screen.queryByText(/Mark (not )?boarded/)).toBeNull();
    });

    // After dive 1 the count is the one the shipped Dive 1 checkpoint keeps open until
    // everyone who left the dock is back: nine of nine, both rows tapped.
    it("draws Dive 1 with every diver counted back aboard", () => {
      const { container } = render(<CaptainRollCallFallback locale="en-US" state="afterDive" />);
      expect(screen.getByText("Dive 1 roll call")).toBeInTheDocument();
      expect(screen.queryByText("Before departure roll call")).toBeNull();
      expect(screen.getByText("9")).toBeInTheDocument();
      const marks = container.querySelectorAll("span.size-14.rounded-full");
      expect(marks).toHaveLength(2);
      for (const mark of marks) expect(mark).toHaveClass("bg-success");
    });

    it("draws the dock checkpoint in Spanish", () => {
      render(<CaptainRollCallFallback locale="es-ES" />);
      expect(screen.getByText("de 9 buceadores a bordo")).toBeInTheDocument();
      expect(screen.getByText("Inm. 1")).toBeInTheDocument();
    });
  });

  describe("RecapPageFallback, the diver's after-trip page", () => {
    it("draws the dive log entry, the crew's note and the one ask", () => {
      render(<RecapPageFallback locale="en-US" />);
      // The keepsake and the one ask, the two blocks the homepage's recap
      // step quotes: the shop wrote something, and the diver is asked once.
      expect(screen.getByText("Dive log entry")).toBeInTheDocument();
      expect(screen.getByText("Photos from the trip")).toBeInTheDocument();
      expect(screen.getByText("Depth over time")).toBeInTheDocument();
      expect(screen.getByText("Seen on your dive")).toBeInTheDocument();
    });

    it("draws the crew's note and the one ask on the review view", () => {
      render(<RecapPageFallback locale="en-US" view="review" />);
      expect(screen.getByText("From your crew")).toBeInTheDocument();
      expect(screen.getByText("How was your day?")).toBeInTheDocument();
    });

    it("renders in Spanish", () => {
      render(<RecapPageFallback locale="es-ES" />);
      expect(screen.getByText("Fotos del viaje")).toBeInTheDocument();
      expect(
        screen.getByText("Arrecife de dos tanques · Sábado · 13 de junio"),
      ).toBeInTheDocument();
    });

    // The demo shop is in Key Largo and its own recap reads Fahrenheit and
    // feet; the mock read "27°C · 24 m" and "Saturday · Jun 14", a Sunday in
    // 2026 (the market sheet of 2026-10-22, item 7).
    it("pictures a Florida shop on a Saturday that is one", () => {
      render(<RecapPageFallback locale="en-US" />);
      expect(screen.getByText("81°F")).toBeInTheDocument();
      expect(screen.getByText("59 ft")).toBeInTheDocument();
      expect(screen.getByText("Two-Tank Reef · Saturday · Jun 13")).toBeInTheDocument();
      expect(new Date(Date.UTC(2026, 5, 13)).getUTCDay()).toBe(6);
    });
  });

  describe("NightBeforeBriefFallback, the diver's trip page", () => {
    it("renders the dock time and the checklist's own words", () => {
      render(<NightBeforeBriefFallback locale="en-US" />);
      expect(screen.getByText(/Aim to be at the dock by/)).toBeInTheDocument();
      expect(screen.getAllByText("Done")).toHaveLength(2);
      expect(screen.getByText("Your turn")).toBeInTheDocument();
    });

    it("renders in Spanish", () => {
      render(<NightBeforeBriefFallback locale="es-ES" />);
      expect(screen.getByText("Exención")).toBeInTheDocument();
      expect(screen.getAllByText("Hecho")).toHaveLength(2);
      expect(screen.getByText("Te toca")).toBeInTheDocument();
    });
  });

  describe("ImportPreviewFallback", () => {
    it("renders the import preview mockup in English", () => {
      render(<ImportPreviewFallback locale="en-US" />);
      expect(screen.getByText("Import preview")).toBeInTheDocument();
      expect(screen.getByText("Nothing saves until you say so")).toBeInTheDocument();
    });

    it("renders the import preview mockup in Spanish", () => {
      render(<ImportPreviewFallback locale="es-ES" />);
      expect(screen.getByText("Vista previa de importación")).toBeInTheDocument();
    });

    // Three tiles in a row leave a 60.67px label box at 360, and "Certifications"
    // is 64.8px at 10px, so it ran 4px past its tile (K-122). The tiles give up
    // 4px of padding a side below sm, where the row is narrowest. That is not
    // enough for es-ES's "Certificaciones", one word of about 72.9px against
    // the 68.67px box, so the columns also never shrink a tile below its own
    // longest word: the other two tiles give up the difference.
    it.each([
      ["en-US", ["Divers in file", "Certifications", "Skipped"]],
      ["es-ES", ["Buceadores en el archivo", "Certificaciones", "Omitidos"]],
    ] as const)("keeps every %s stat label inside its tile at 360", (locale, labels) => {
      render(<ImportPreviewFallback locale={locale} />);
      for (const label of labels) {
        const tile = screen.getByText(label).parentElement;
        expect(tile).toHaveClass("px-2", "sm:px-3");
        expect(tile).not.toHaveClass("px-3");
        const grid = tile?.parentElement;
        expect(grid).toHaveClass("grid-cols-[repeat(3,minmax(min-content,1fr))]");
        expect(grid).not.toHaveClass("grid-cols-3");
      }
    });
  });

  describe("ExportBundleFallback", () => {
    it("renders the export bundle mockup in English", () => {
      render(<ExportBundleFallback locale="en-US" />);
      expect(screen.getByText("Data export")).toBeInTheDocument();
    });

    /**
     * **The row counts are numbers, and the message formats them.**
     *
     * `fallback.export.rowCount` became an ICU plural (issue #778) while these
     * three mock figures were still pre-grouped *strings* — and `"1,204"` is
     * not a number, so ICU rendered **NaN rows** on the pricing page. Nothing
     * failed: no test read the figure, and it took the pricing page's own
     * visual capture to see it. The upside of the fix is that the grouping is
     * the reader's now rather than hard-coded English.
     */
    it.each([
      ["en-US", "1,204 rows", "128 rows"],
      ["es-ES", "1204 filas", "128 filas"],
    ])("formats the row counts for %s", (locale, biggest, smallest) => {
      render(<ExportBundleFallback locale={locale as "en-US" | "es-ES"} />);
      expect(screen.getByText(biggest)).toBeInTheDocument();
      expect(screen.getByText(smallest)).toBeInTheDocument();
      expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    it("renders the export bundle mockup in Spanish", () => {
      render(<ExportBundleFallback locale="es-ES" />);
      expect(screen.getByText("Exportar datos")).toBeInTheDocument();
    });
  });
});

describe("FrontDeskReadinessFallback stage chip", () => {
  it.each(["en-US", "es-ES"] as const)("shows the staff boarding word in %s", (locale) => {
    render(<FrontDeskReadinessFallback locale={locale} />);
    expect(screen.getByText(staffTranslator(locale)(STAGE_WORD_KEYS.boarding))).toBeVisible();
    expect(screen.queryByText("Check-in")).toBeNull();
  });
});

describe("the walkthrough's taps are Priya's", () => {
  it("marks Priya's mark, not Tom's, as the one the crew taps after dive 1", () => {
    const { container } = render(
      <CaptainRollCallFallback locale="en-US" state="afterDivePending" />,
    );
    const rows = container.querySelectorAll(".marketing-roll-call-row");
    expect(rows[0]).toHaveTextContent("Priya Sharma");
    expect(rows[0]?.querySelector("[data-tap-target]")).not.toBeNull();
    expect(rows[1]?.querySelector("[data-tap-target]")).toBeNull();
  });

  it("taps Priya's own nudge before the list says it went out", () => {
    const before = render(<FrontDeskReadinessFallback locale="en-US" state="unsigned" />);
    expect(before.container.querySelector("[data-tap-target]")).toHaveTextContent("Nudge waiver");
    before.unmount();
    const after = render(<FrontDeskReadinessFallback locale="en-US" state="nudged" />);
    expect(after.container.querySelector("[data-tap-target]")).toBeNull();
    expect(screen.getByText("Nudge sent")).toBeInTheDocument();
  });
});

it("WalkTyped numbers every character in reading order, so a wrapped line fills before the next", () => {
  const { container } = render(<WalkTyped text="one two three" delay={0} />);
  const places = [...container.querySelectorAll<HTMLElement>("[data-walk-char]")].map((c) =>
    c.style.getPropertyValue("--i"),
  );
  expect(places).toEqual(["0", "1", "2", "4", "5", "6", "8", "9", "10", "11", "12"]);
  expect(container.textContent).toBe("one two three");
});
