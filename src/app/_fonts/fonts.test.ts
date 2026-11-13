import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The font module's one trap, read off its source (issue #2516):
 * `next/font/local` writes a call's CSS variable from the *constant's* name,
 * whatever family the call declares. A subset call that declares a family no
 * variable names, or a variable naming a family nothing declares, paints every
 * word in the fallback and nothing fails until the pixels do.
 */
const dir = path.join(process.cwd(), "src/app/_fonts");
const source = readFileSync(path.join(dir, "fonts.ts"), "utf8");
const calls = [...source.matchAll(/const (\w+) = localFont\(\{([\s\S]*?)\n\}\);/g)].map(
  ([, name, body]) => ({
    name,
    family: body.match(/prop: "font-family", value: "([^"]+)"/)?.[1],
    variable: body.match(/variable: "([^"]+)"/)?.[1],
    files: [...body.matchAll(/path: "\.\/([^"]+)"/g)].map(([, file]) => file),
  }),
);

describe("the self-hosted fonts", () => {
  it("declares every face under the name of a call whose constant carries it", () => {
    expect(calls.length).toBeGreaterThan(0);
    const names = new Set(calls.map((call) => call.name));
    for (const call of calls)
      expect(names, `${call.name} declares ${call.family}`).toContain(call.family);
  });

  it("gives each variable globals.css reads to the call named for its family", () => {
    const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const read = new Set(
      [...globals.matchAll(/var\((--font-(?:plex|atkinson|noto)[\w-]*)\)/g)].map((m) => m[1]),
    );
    expect([...read].sort()).toEqual([
      "--font-atkinson",
      "--font-noto-symbols",
      "--font-plex-mono",
      "--font-plex-sans",
    ]);
    for (const variable of read) {
      const owner = calls.find((call) => call.variable === variable);
      expect(owner?.family, variable).toBe(owner?.name);
    }
  });

  it("commits every file it loads", () => {
    for (const call of calls)
      for (const file of call.files) expect(existsSync(path.join(dir, file)), file).toBe(true);
  });
});

// These are the product glyphs in the original symbols face, including source
// labels as well as both locales. Arrows are already in the separate math face.
const productSymbols = "⌘▾◆◇●◐★☑⚠✓";
const productRange = [...productSymbols]
  .map((glyph) => `U+${glyph.codePointAt(0)?.toString(16).toUpperCase()}`)
  .join(", ");

it("loads only the product symbols and keeps source and locale symbols pinned", () => {
  const symbolsCall = source.split("const notoSymbolsSymbols =")[1].split("\n});")[0];
  expect(symbolsCall).toContain(`"${productRange}"`);
  // The math face supplies arrows; circled information and pictographic emoji
  // already used platform fallback and must keep that existing rendering.
  const existingOtherFaces = "←↑→↓↔↗↵−≈≤⋯⏳ⓘ✅❌";
  for (const file of globSync(["src/i18n/locales/**/*.json", "src/**/*.tsx"])) {
    const raw = readFileSync(file, "utf8");
    const text = file.endsWith(".json")
      ? JSON.stringify(JSON.parse(raw))
      : raw.replace(/\\u([0-9a-f]{4})/gi, (_, point) =>
          String.fromCodePoint(Number.parseInt(point, 16)),
        );
    for (const glyph of text) {
      const point = glyph.codePointAt(0) ?? 0;
      if (
        (point >= 0x20dd && point <= 0x20e4) ||
        (point >= 0x2150 && point <= 0x2bff) ||
        (point >= 0x4dc0 && point <= 0x4dff)
      ) {
        expect(
          productSymbols + existingOtherFaces,
          `${file}: ${glyph} U+${point.toString(16)}`,
        ).toContain(glyph);
      }
    }
  }
  expect(readFileSync(path.join(dir, "noto-sans-symbols-2-symbols-400.woff2")).length).toBeLessThan(
    5000,
  );
});

it("pins the verified ten-glyph binary rather than silently accepting a different cmap", () => {
  const bytes = readFileSync(path.join(dir, "noto-sans-symbols-2-symbols-400.woff2"));
  // fontTools 4.68.0: cmap, outlines and advances compared with the original
  // committed font. A replacement needs that same verification and pixel review.
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "7574c863b9fb2a5f81ee81ce302f6ea08b77fa8cf98e0d332934a0dd589ab0da",
  );
});
