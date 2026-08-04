import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOgFonts, OG_FONT_FAMILY } from "./og-fonts";

describe("loadOgFonts", () => {
  it("resolves both weights the OG cards render with", async () => {
    const fonts = await loadOgFonts();
    expect(fonts.map((f) => f.weight).sort()).toEqual([400, 600]);
    expect(fonts.every((f) => f.name === OG_FONT_FAMILY)).toBe(true);
    expect(fonts.every((f) => f.style === "normal")).toBe(true);
  });

  it("reads real TrueType files", async () => {
    // The whole point of this module is that the bytes are in hand before an
    // ImageResponse is constructed, so assert they are actually a parseable
    // font and not, say, an HTML error page that a download once produced.
    // 0x00010000 is the TrueType outline version tag.
    for (const font of await loadOgFonts()) {
      expect(font.data.byteLength).toBeGreaterThan(10_000);
      expect(new DataView(font.data).getUint32(0)).toBe(0x00010000);
    }
  });

  it("hands out exactly each file's bytes, not a pooled buffer's whole extent", async () => {
    // A Node Buffer is a window onto a shared pool. Passing `.buffer` through
    // unsliced yields a larger ArrayBuffer whose leading bytes belong to
    // something else entirely — satori then fails to parse it, which is the
    // very lazy-font failure this module exists to prevent. Compare against
    // the files on disk so this measures the real thing.
    const fonts = await loadOgFonts();
    const sizes = await Promise.all(
      ["Geist-400.ttf", "Geist-600.ttf"].map(
        async (file) => (await stat(join(process.cwd(), "assets", "fonts", file))).size,
      ),
    );
    expect(fonts.map((f) => f.data.byteLength)).toEqual(sizes);
  });

  it("reuses one read across calls", async () => {
    const [first, second] = await Promise.all([loadOgFonts(), loadOgFonts()]);
    expect(first).toBe(second);
  });
});
