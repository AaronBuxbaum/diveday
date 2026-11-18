import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A link's arrow is drawn by its style (`ARROW_LINK_CLASS`, `buttonClass({ arrow })`), never typed
 * into a bundle string, where a second link could forget it or a translation drop it. A path
 * ("Settings → Import contacts") keeps its arrows; a string that ENDS in one is a link label.
 */
describe("no bundle string ends in a typed arrow", () => {
  const root = join(process.cwd(), "src/i18n/locales");
  for (const locale of readdirSync(root)) {
    const dir = join(root, locale, "content");
    for (const file of readdirSync(dir)) {
      it(`${locale}/${file}`, () => {
        const text = readFileSync(join(dir, file), "utf8");
        expect(text.match(/"[^"\n]* →"/g) ?? []).toEqual([]);
      });
    }
  }
});
