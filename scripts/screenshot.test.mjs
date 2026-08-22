import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The one thing about this script a unit test can hold, and the exact bug that
 * broke it.
 *
 * `page.waitForFunction`'s predicate is serialized and run **inside the page**,
 * where this module's `const`s do not exist. Written as
 * `waitForFunction(() => !document.querySelector(SKELETON_SELECTOR))` it threw
 * `ReferenceError: SKELETON_SELECTOR is not defined` on every route — and the
 * catch around it turned that into "the page never finished streaming", which
 * sends the reader to the dev server's log instead of to the line that is
 * wrong. Every capture the tool took failed, and the message said the app was
 * at fault.
 *
 * The script is a CLI that runs on import, so it cannot be imported and its
 * predicate cannot be called; the honest thing a test can check is that the
 * selector is still handed across the boundary rather than closed over.
 */
describe("the skeleton wait", () => {
  const source = readFileSync(path.join(process.cwd(), "scripts/screenshot.mjs"), "utf8");
  // Bounded to this one call. The file has a second `waitForFunction` whose
  // predicate genuinely takes no argument — it reads `document.title`, a
  // browser global that exists on the far side — and that one is correct.
  const start = source.indexOf("page.waitForFunction(");
  const call = source.slice(start, source.indexOf("});", start) + 3);

  it("takes the selector as an argument, because the predicate runs in the page", () => {
    // A zero-argument predicate here could only be reading a binding that does
    // not exist on the other side of the boundary.
    expect(call).not.toMatch(/waitForFunction\(\s*\(\)\s*=>/);
    expect(call).toMatch(/waitForFunction\(\s*\(\w+\)\s*=>/);
  });

  it("still passes the selector this module defines", () => {
    // Guards the other half: an inlined literal here would drift from the
    // documented `SKELETON_SELECTOR` without anything noticing.
    expect(call).toContain("SKELETON_SELECTOR");
  });
});
