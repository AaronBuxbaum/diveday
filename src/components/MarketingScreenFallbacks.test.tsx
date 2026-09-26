// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaptainRollCallFallback,
  DiverBookingFallback,
  ExportBundleFallback,
  FrontDeskReadinessFallback,
  ImportPreviewFallback,
  NightBeforeBriefFallback,
  RecapPageFallback,
  ShopPrepListFallback,
} from "./MarketingScreenFallbacks";

afterEach(cleanup);

const EVERY_MOCK = [
  ["CaptainRollCallFallback", CaptainRollCallFallback],
  ["FrontDeskReadinessFallback", FrontDeskReadinessFallback],
  ["ImportPreviewFallback", ImportPreviewFallback],
  ["ExportBundleFallback", ExportBundleFallback],
  ["DiverBookingFallback", DiverBookingFallback],
  ["RecapPageFallback", RecapPageFallback],
  ["NightBeforeBriefFallback", NightBeforeBriefFallback],
  ["ShopPrepListFallback", ShopPrepListFallback],
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
 * "Mark boarded" and "Download" were 44px and the recap's "Leave my review"
 * 40px, off the button ladder, with the class string otherwise identical
 * (K-516). One drawn primary button, at the `sm` rung's 44px.
 */
describe("the mocks' primary button", () => {
  it("is one 44px button in every mock that draws one", () => {
    const buttons = EVERY_MOCK.flatMap(([, Mock]) => {
      const { container, unmount } = render(<Mock locale="en-US" />);
      const found = Array.from(container.querySelectorAll("button"));
      const classes = found.map((button) => button.className);
      unmount();
      return classes;
    });
    expect(buttons.length).toBeGreaterThanOrEqual(4);
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
 * line and gives way to a badge that never shrinks, 12px apart.
 */
describe("the mocks' checklist rows", () => {
  it.each([
    ["ShopPrepListFallback", ShopPrepListFallback, "Crew assigned (Mateo & Sarah)"],
    ["NightBeforeBriefFallback", NightBeforeBriefFallback, "Waiver"],
  ] as const)("%s wraps a long label cleanly beside its badge", (_name, Mock, text) => {
    render(<Mock locale="en-US" />);
    const label = screen.getByText(text);
    expect(label).toHaveClass("min-w-0", "text-pretty");
    const row = label.parentElement;
    expect(row).toHaveClass("gap-3");
    expect(label.nextElementSibling).toHaveClass("shrink-0");
  });
});

describe("MarketingScreenFallbacks", () => {
  describe("ShopPrepListFallback", () => {
    it("renders in English with crew staging checklist", () => {
      render(<ShopPrepListFallback locale="en-US" />);
      expect(screen.getByText("Trip prep")).toBeInTheDocument();
      expect(screen.getByText("Two-Tank Morning Reef")).toBeInTheDocument();
      expect(screen.getByText("Staging checklist")).toBeInTheDocument();
      expect(screen.getByText("Rental gear staged")).toBeInTheDocument();
    });

    it("renders in Spanish with crew staging checklist", () => {
      render(<ShopPrepListFallback locale="es-ES" />);
      expect(screen.getByText("Preparación de salida")).toBeInTheDocument();
      expect(screen.getByText("Arrecife dos botellas matinal")).toBeInTheDocument();
      expect(screen.getByText("Lista de preparación")).toBeInTheDocument();
      expect(screen.getByText("Equipos de alquiler preparados")).toBeInTheDocument();
    });
  });

  describe("NightBeforeBriefFallback", () => {
    it("renders in English with checklist and weather details", () => {
      render(<NightBeforeBriefFallback locale="en-US" />);

      // Check title and details
      expect(screen.getByText("Ready brief")).toBeInTheDocument();
      expect(screen.getByText("Two-Tank Reef")).toBeInTheDocument();
      expect(screen.getByText("Your pre-trip checklist")).toBeInTheDocument();

      // Check status elements
      expect(screen.getByText("Waiver")).toBeInTheDocument();
      expect(screen.getAllByText("Completed")).toHaveLength(3);
    });

    it("renders in Spanish with checklist and weather details", () => {
      render(<NightBeforeBriefFallback locale="es-ES" />);

      // Check title and details in Spanish
      expect(screen.getByText("Resumen de preparación")).toBeInTheDocument();
      expect(screen.getByText("Tu lista de control previa al viaje")).toBeInTheDocument();
      expect(screen.getByText("Exención")).toBeInTheDocument();
      expect(screen.getAllByText("Completada")).toHaveLength(3);
    });
  });

  describe("ImportPreviewFallback", () => {
    it("renders the import preview mockup in English", () => {
      render(<ImportPreviewFallback locale="en-US" />);
      expect(screen.getByText("Import preview")).toBeInTheDocument();
      expect(screen.getByText("Nothing saves until you say so.")).toBeInTheDocument();
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
