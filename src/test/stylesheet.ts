import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * **`globals.css`, read as rules rather than as text**, for the tests that
 * pin what the stylesheet asks for without a browser (`src/app/*.test.ts`).
 *
 * A rule's *layer* decides what it can beat — an unlayered declaration beats
 * every Tailwind utility whatever its specificity, a `@layer base` one loses
 * to all of them — so the helpers keep the two apart. What a selector matches
 * is the DOM's to say: a jsdom test hands `rule.prelude` to `element.matches`.
 */
export type CssBlock = { prelude: string; body: string };

/** The app's stylesheet with its comments stripped. */
export function readGlobalsCss(): string {
  return readFileSync(path.join(import.meta.dirname, "..", "app", "globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

/** The `prelude { body }` blocks at the top level of `css`, braces balanced. */
export function topLevelBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === "{") {
      if (depth === 0) open = index;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, index) });
        start = index + 1;
      }
    } else if (char === ";" && depth === 0) {
      start = index + 1;
    }
  }
  return blocks;
}

/**
 * Every style rule outside any cascade layer. `@media`, `@supports` and
 * `@container` are walked into; `@layer`, `@utility`, `@theme` and the other
 * directives are layered (or emit nothing) and are skipped.
 */
export function unlayeredRules(css: string): CssBlock[] {
  return topLevelBlocks(css).flatMap((block) => {
    if (/^@(media|supports|container)\b/.test(block.prelude)) return unlayeredRules(block.body);
    if (block.prelude.startsWith("@")) return [];
    return [block];
  });
}

/** The style rules inside the stylesheet's `@layer base` blocks. */
export function baseLayerRules(css: string): CssBlock[] {
  return topLevelBlocks(css)
    .filter((block) => block.prelude === "@layer base")
    .flatMap((block) => topLevelBlocks(block.body));
}

/** A declaration block's `property: value` pairs, whitespace-normalised. */
export function declarations(body: string): Record<string, string> {
  return Object.fromEntries(
    body
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(":");
        return [
          part.slice(0, colon).trim(),
          part
            .slice(colon + 1)
            .trim()
            .replace(/\s+/g, " "),
        ];
      }),
  );
}
