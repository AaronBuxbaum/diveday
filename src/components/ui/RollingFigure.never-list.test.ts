import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **A head count never rolls, and no reviewer should have to remember that** —
 * ADR 20260907-nothing-from-nowhere, decision 1's fourth test and decision 3.
 *
 * A rolling digit is neither number for 200ms. On the counter that is worth it:
 * the figure is a front-desk convenience, the surface is optimistic by design
 * (principle 1), and a wrong reading costs a second glance. On the **roll call
 * and the manifest** it is not: that figure is the one a crew reads in glare,
 * once, to decide whether the boat leaves with everybody on it, and principle 1
 * already refuses to let that surface show a number the server has not
 * confirmed. A number that is mid-flight for a fifth of a second is the same
 * failure wearing a nicer coat.
 *
 * The rule survives H-69 c either way: whether or not the *slide* is allowed to
 * close a gap on the roster, the head count does not roll.
 *
 * This is a grep rather than a render test on purpose. What has to hold is
 * "nothing under these directories reaches for this component", which no
 * rendering of today's tree can prove about tomorrow's — and the failure it
 * guards against is somebody adding the import in good faith, three months from
 * now, on a surface that looks like every other one.
 */

const ROOT = path.join(import.meta.dirname, "../..");

/** The surfaces where a figure must be one of two numbers and never between. */
const NEVER = [
  "app/shop/[shopSlug]/trips/[id]/manifest",
  "app/offline-manifest",
  "components/OfflineManifestView.tsx",
];

async function filesUnder(target: string): Promise<string[]> {
  const full = path.join(ROOT, target);
  const entries = await readdir(full, { withFileTypes: true, recursive: true }).catch(() => null);
  if (entries === null) return [full];
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("the roll's never-list", () => {
  it("keeps RollingFigure off every roll-call and manifest surface", async () => {
    const offenders: string[] = [];
    for (const target of NEVER) {
      for (const file of await filesUnder(target)) {
        const source = await readFile(file, "utf8").catch(() => "");
        if (source.includes("RollingFigure")) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders, "a head count is never mid-roll").toEqual([]);
  });

  /**
   * The list is only worth anything while it points at directories that exist:
   * a manifest moved to a new path would silently empty this test rather than
   * fail it.
   */
  it("points at surfaces that are still there", async () => {
    for (const target of NEVER) {
      const files = await filesUnder(target);
      expect(files.length, `${target} has no files — has the surface moved?`).toBeGreaterThan(0);
    }
  });
});
