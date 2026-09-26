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

/**
 * The bar's label sat 16px in over bodies inset 20px, so the shop name and the
 * body's eyebrow missed each other by 4px on every mock but the roll call,
 * whose body was 16px too (K-51). One 20px inset now, bar and body alike.
 */
describe("the mock family's inset", () => {
  it.each(EVERY_MOCK)("%s starts its bar and its body on one 20px edge", (_name, Mock) => {
    const { bar, body } = barAndBody(Mock);
    expect(bar).toHaveClass("px-5");
    expect(body).toHaveClass("px-5");
    expect(bar.className).not.toMatch(/(^|\s)p[xl]?-4(\s|$)/);
    expect(body.className).not.toMatch(/(^|\s)p[xl]?-4(\s|$)/);
  });

  // In /about's 290px phone screen both halves of the bar wrapped inside
  // themselves: "BLUE MANTIS / DIVERS" beside "Offline copy · up to / date"
  // (K-398). Each half is one unit; when the pair does not fit on one line the
  // label moves under the name whole. Not `truncate`: an ellipsis there would
  // cut "up to date", which is the half of the label that says anything.
  it.each(EVERY_MOCK)("%s never splits the shop name or the bar's label", (_name, Mock) => {
    const { bar } = barAndBody(Mock);
    expect(bar).toHaveClass("flex-wrap", "gap-x-3");
    const [name, label] = Array.from(bar.children);
    expect(name).toHaveClass("whitespace-nowrap");
    expect(label).toHaveClass("whitespace-nowrap");
    expect(label).not.toHaveClass("truncate");
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
