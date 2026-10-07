import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
/** Each `<SectionCard>` opening tag's `padding`, `md` where it names none (the default). */
function cardInsets(source: string): string[] {
  return source
    .split("<SectionCard")
    .slice(1)
    .map((tag) => /^[^>]*?\bpadding="(\w+)"/.exec(tag)?.[1] ?? "md");
}

/**
 * **One inset down the page's column.** The crew sheet was the one card at the
 * default `md` inset among the bundle's `p-5 sm:p-6` summary and five `lg`
 * Backups cards, so its heading started 4px left of every other heading on
 * the page — 449 against 453 at 1280, 33 against 37 at 390, the probe's two
 * `ragged-edges` flags on settings-export (K-52, SETTINGS-2-17).
 */
describe("the export page's cards", () => {
  it("sit at the lg inset, or pad their own parts at it", () => {
    const backups = readFileSync(
      join(import.meta.dirname, "_components", "BackupsSection.tsx"),
      "utf8",
    );
    const insets = [...cardInsets(SOURCE), ...cardInsets(backups)];
    expect(insets.length, "every SectionCard on the page is counted").toBeGreaterThanOrEqual(7);
    for (const inset of insets) expect(["lg", "none"]).toContain(inset);
  });
});
