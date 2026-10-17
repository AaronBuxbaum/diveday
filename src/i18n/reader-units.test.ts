import { describe, expect, it } from "vitest";
import { readerUnitsFrom } from "./reader-units";

/** Fifth-loop ideas, item 22: which unit a visitor thinks in. */
describe("readerUnitsFrom", () => {
  it("reads the browser's region: metric in Germany and Brazil, imperial in the US", () => {
    expect(readerUnitsFrom("de-DE,de;q=0.9,en;q=0.8", "en-US")).toEqual({
      depth: "meters",
      temperature: "celsius",
    });
    expect(readerUnitsFrom("pt-BR", "en-US")).toEqual({ depth: "meters", temperature: "celsius" });
    expect(readerUnitsFrom("en-US,en;q=0.9", "en-US")).toEqual({
      depth: "feet",
      temperature: "fahrenheit",
    });
    expect(readerUnitsFrom("en-GB", "en-US")).toEqual({ depth: "meters", temperature: "celsius" });
  });

  it("keeps Fahrenheit where only the temperature is imperial", () => {
    expect(readerUnitsFrom("en-BS", "en-US")).toEqual({
      depth: "meters",
      temperature: "fahrenheit",
    });
  });

  it("reads a language with no region as metric, except English, which says nothing", () => {
    expect(readerUnitsFrom("es", "es-ES")).toEqual({ depth: "meters", temperature: "celsius" });
    expect(readerUnitsFrom("en", "en-US")).toEqual({ depth: null, temperature: null });
  });

  it("falls back to the page's language with no header: Spanish reads metric", () => {
    expect(readerUnitsFrom(null, "es-ES")).toEqual({ depth: "meters", temperature: "celsius" });
    expect(readerUnitsFrom(null, "en-US")).toEqual({ depth: null, temperature: null });
    expect(readerUnitsFrom("*", "en-US")).toEqual({ depth: null, temperature: null });
  });
});
