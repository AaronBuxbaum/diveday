import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **`/about` keeps one column and one rhythm** (docs/design/pixel-craft.md,
 * classes 3 and 4). Read from the source, because both defects are a class
 * string that renders right at one width and wrong at another.
 */
const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

describe("/about's founder band", () => {
  /**
   * The heading and the paragraphs are two grid items, so when the grid
   * stacks below `lg` its column gap becomes the heading-to-body gap: 40px,
   * where every other band sets its body `mt-4`/`mt-5` under its heading. The
   * probe measured 50px of ink-to-ink there against 26–31 in the other four
   * bands (K-577).
   */
  it("stacks its heading over its body at the other bands' gap, and keeps 40px between columns", () => {
    expect(PAGE).toContain(
      'className="grid gap-5 lg:grid-cols-[0.9fr_1fr] lg:items-start lg:gap-10"',
    );
    expect(PAGE).not.toContain('className="grid gap-10 lg:grid-cols-[0.9fr_1fr]');
  });
});

describe("/about's start-of-line links", () => {
  /**
   * A link button keeps its size's `px-4` unless it passes `flush`, so a link
   * that starts a line under text sits 16px inside the column. Both of these
   * do: "See the product" wraps under the band's two outline doors, and the
   * switching link sits under its paragraph. The landing's start-of-line
   * doors already pass it (K-397).
   */
  it("passes flush on both, so their words start on the column", () => {
    const links = PAGE.match(/buttonClass\(\{[^}]*variant: "link"[^}]*\}\)/g) ?? [];
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toMatch(/flush: true/);
  });
});
