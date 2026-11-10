import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AA_TEXT_CONTRAST, contrastRatio, mixHex } from "./brand";

/** The current day/night inks and empty-field ink keep 4.5:1 on their real fills. */
const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const block = (marker: string) => {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block: ${marker}`);
  return css.slice(start, css.indexOf("}", start));
};
const tokensIn = (source: string) =>
  Object.fromEntries(
    Array.from(source.matchAll(/--([a-z-]+):\s*([^;]+);/g), ([, name, value]) => [
      name,
      value?.trim(),
    ]),
  ) as Record<string, string>;
const day = tokensIn(block(":root {"));
const night = { ...day, ...tokensIn(block("@media (prefers-color-scheme: dark) {\n  :root {")) };

for (const [scheme, tokens] of [
  ["light", day],
  ["dark", night],
] as const) {
  describe(`${scheme} text contrast`, () => {
    const resolve = (value: string, ground = "#ffffff"): string => {
      const variable = value.match(/^var\(--([a-z-]+)\)$/)?.[1];
      if (variable) return resolve(tokens[variable] ?? "", ground);
      if (/^#[0-9a-f]{6}$/i.test(value)) return value;
      const strong = value.match(/^color-mix\(in srgb, black (\d+)%, var\(--([a-z-]+)\)\)$/);
      if (strong)
        return mixHex(resolve(`var(--${strong[2]})`, ground), "#000000", Number(strong[1]) / 100);
      const translucent = value.match(
        /^color-mix\(in srgb, var\(--([a-z-]+)\) (\d+)%, transparent\)$/,
      );
      if (translucent)
        return mixHex(
          ground,
          resolve(`var(--${translucent[1]})`, ground),
          Number(translucent[2]) / 100,
        );
      throw new Error(`Unhandled text color: ${value}`);
    };
    const token = (name: string) => resolve(`var(--${name})`);
    const check = (ink: string, fill: string) =>
      expect(contrastRatio(ink, fill), `${ink} on ${fill}`).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      );

    it("keeps reading and status inks above 4.5 on the shell and each opaque wash", () => {
      for (const ink of [
        "foreground",
        "muted",
        "primary",
        "primary-hover",
        "success",
        "success-strong",
        "warning",
        "warning-strong",
        "danger",
        "info",
        "accent-deep",
      ]) {
        for (const fill of ["surface", "background", "surface-sunken"])
          check(token(ink), token(fill));
      }
      for (const [fill, ink] of [
        ["primary-tint", "primary"],
        ["success-tint", "success-strong"],
        ["warning-tint", "warning-strong"],
        ["danger-tint", "danger"],
        ["accent-tint", "accent-deep"],
      ]) {
        for (const text of [ink, "foreground", "muted"]) check(token(text), token(fill));
      }
      for (const fill of ["primary", "primary-hover"])
        check(token("primary-foreground"), token(fill));
      check(token("accent-foreground"), token("accent"));
    });

    it("keeps placeholders and empty native date/time masks readable on form fills", () => {
      for (const selector of [
        "input::placeholder,\n  textarea::placeholder {",
        "input[data-empty]:not(:focus)::-webkit-datetime-edit {",
      ]) {
        const value = block(selector).match(/color:\s*([^;]+);/)?.[1];
        expect(value).toBeDefined();
        for (const fill of ["surface", "background", "surface-sunken"]) {
          const background = token(fill);
          check(resolve(value ?? "", background), background);
        }
      }
    });
  });
}
