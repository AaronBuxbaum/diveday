import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DeparturePaperIdentity,
  departurePaperRule,
  formatPaperDateTime,
  normalizePaperFact,
  paperCssString,
  paperFactLines,
} from "./DeparturePaperIdentity";

describe("departure paper identity", () => {
  it("prints the full year in the shop calendar even across the UTC year boundary", () => {
    const instant = new Date("2026-01-01T01:00:00Z");
    for (const locale of ["en-US", "es-ES"]) {
      expect(formatPaperDateTime(instant, locale, "America/New_York")).toContain("2025");
      expect(formatPaperDateTime(instant, locale, "UTC")).toContain("2026");
    }
  });

  it("keeps untrusted names inside a CSS string and style element", () => {
    const attack = '</style><script>evil()</script>"\\\n';
    const escaped = paperCssString(attack);
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    expect(escaped).not.toContain("\n");
    expect(escaped).toContain("\\3c ");
    expect(escaped).toContain("\\22 ");
    expect(escaped).toContain("\\5c ");
    expect(escaped).toContain("\\a ");
  });

  it("rejects unsafe page selectors", () => {
    expect(() => departurePaperRule("departure-a} @page {", [], "")).toThrow();
  });

  it("reserves additional space when identity wraps, without truncating its words", () => {
    const title = "Very long departure title ".repeat(16);
    const normal = departurePaperRule("departure-a", ["Shop", "Trip"], "Printed");
    const long = departurePaperRule("departure-a", ["Shop", title], "Printed");
    const topMargin = (css: string) => Number(css.match(/margin-top:(\d+)mm/)?.[1]);
    expect(topMargin(long)).toBeGreaterThan(topMargin(normal));
    expect(paperFactLines(title).join("")).toBe(title.trim());
    expect(long).toContain('counter(page) " / " counter(pages)');
  });

  it("normalizes adversarial newlines and Unicode break characters before sizing and rendering", () => {
    const multiline = `${"X\n".repeat(59)}X`;
    const normalized = Array(60).fill("X").join(" ");
    expect(normalizePaperFact(multiline)).toBe(normalized);
    expect(departurePaperRule("departure-a", [multiline], "Printed")).toBe(
      departurePaperRule("departure-a", [normalized], "Printed"),
    );
    expect(normalizePaperFact("  A\r\n\t\u0085\u2028\u2029\u200b\u2060\u00a0B  ")).toBe("A B");
    const unicode = "潜水 🚤 é ".repeat(20).trim();
    expect(paperFactLines(unicode).join("")).toBe(unicode);
  });

  it("hard-wraps wide unbroken names without losing text or splitting Unicode characters", () => {
    for (const value of ["W".repeat(120), "Z".repeat(120), "🚤".repeat(60), "潜水".repeat(60)]) {
      const lines = paperFactLines(value);
      expect(lines.join("")).toBe(value);
      expect(lines.every((line) => line.length <= 60)).toBe(true);
      expect(lines.every((line) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(line))).toBe(true);
    }
    const css = departurePaperRule("departure-a", ["W".repeat(120)], "Printed");
    expect(css).toContain(`${"W".repeat(60)}\\a ${"W".repeat(60)}`);
    expect(css).toContain("margin-top:20mm");
  });

  it("canonicalizes uppercase UUID page names without changing identity text", () => {
    const pageName = "departure-5A5BD26D-553A-4C5C-9609-CA048049F010-manifest";
    const html = renderToStaticMarkup(
      <DeparturePaperIdentity pageName={pageName} identity={["UPPERCASE Boat"]} printed="Printed">
        Roster
      </DeparturePaperIdentity>,
    );
    expect(html).toContain(`data-departure-paper="${pageName.toLowerCase()}"`);
    expect(html).toContain(`page:${pageName.toLowerCase()}`);
    expect(html).toContain("UPPERCASE Boat");
  });

  it("binds each day's departure to its own named page and checkpoint", () => {
    const html = renderToStaticMarkup(
      <>
        <DeparturePaperIdentity
          pageName="departure-a-manifest"
          identity={["Boat A", "Departure"]}
          printed="Printed A"
        >
          Roster A
        </DeparturePaperIdentity>
        <DeparturePaperIdentity
          pageName="departure-b-manifest"
          identity={["Boat B", "Return"]}
          printed="Printed B"
        >
          Roster B
        </DeparturePaperIdentity>
      </>,
    );
    const [first, second] = html.split("</div>");
    expect(first).toContain("page:departure-a-manifest");
    expect(first).toContain("Boat A");
    expect(first).not.toContain("Boat B");
    expect(second).toContain("page:departure-b-manifest");
    expect(second).toContain("Boat B");
    expect(second).not.toContain("Boat A");
  });
});
