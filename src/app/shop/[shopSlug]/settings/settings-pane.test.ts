import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { settingsPaneClass } from "./_components/settings-pane";

/**
 * **One pane, so the column holds still as the rail changes the page.** Each
 * settings page spelled its own `<main>`: `max-w-3xl … sm:py-10` on most,
 * `max-w-2xl` with no `sm:py-10` on Print and the pre-departure checklist,
 * `max-w-5xl` on Team and Website embed. Centred in the pane beside the rail,
 * the three widths started the column at x 476, 428 and 408 at 1280, and the
 * two paddings put the eyebrow 8px apart, so the back link and the title
 * jumped sideways and down with every click in the rail (K-250,
 * SETTINGS-3-03; K-312, SETTINGS-2-24).
 *
 * A source sweep: every `<main>` under settings, page and skeleton alike,
 * takes its class from `settingsPaneClass`, and none spells a width.
 */
const SETTINGS = import.meta.dirname;

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

const MAINS = sourcesUnder(SETTINGS).flatMap((path) => {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/<main\b[^>]*>/g)].map(([tag]) => ({
    file: relative(SETTINGS, path),
    tag,
  }));
});

describe("the settings pane", () => {
  it("finds the hub's main and every sub-page's page and skeleton", () => {
    const files = new Set(MAINS.map(({ file }) => file));
    for (const file of [
      "SettingsPage.tsx",
      "loading.tsx",
      "safety-checklist/page.tsx",
      "safety-checklist/loading.tsx",
      "team/page.tsx",
      "embed/page.tsx",
      "kinds-of-day/loading.tsx",
    ]) {
      expect(files).toContain(file);
    }
  });

  it.each(MAINS)("draws $file's <main> from settingsPaneClass", ({ tag }) => {
    expect(tag).toMatch(/^<main className=\{settingsPaneClass\((?:"5xl")?\)\}>$/);
    expect(tag).not.toMatch(/max-w-/);
  });

  it("keeps the wide pane for the two pages whose content needs it, and only them", () => {
    const wide = [...new Set(MAINS.filter(({ tag }) => tag.includes('"5xl"')).map((m) => m.file))];
    expect(wide.sort()).toEqual([
      "embed/loading.tsx",
      "embed/page.tsx",
      "team/loading.tsx",
      "team/page.tsx",
    ]);
  });

  it("pads every pane alike and starts it on the rail's edge from lg", () => {
    for (const width of ["3xl", "5xl"] as const) {
      const tokens = settingsPaneClass(width).split(" ");
      for (const token of ["mx-auto", "w-full", "flex-1", "px-4", "py-8", "sm:px-6", "sm:py-10"]) {
        expect(tokens).toContain(token);
      }
      expect(tokens).toContain(`max-w-${width}`);
      // Beside the rail (the pane is not the frame's first child), the column
      // starts on the pane's own edge whatever its width; with no rail (a
      // staffer's own calendar feed), it stays centred as it always was.
      expect(tokens).toContain("lg:[:not(:first-child)>&]:mx-0");
    }
    expect(settingsPaneClass()).toBe(settingsPaneClass("3xl"));
  });
});
