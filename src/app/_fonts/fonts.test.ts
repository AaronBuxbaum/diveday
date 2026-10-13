import { existsSync, readFileSync } from "node:fs";
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
