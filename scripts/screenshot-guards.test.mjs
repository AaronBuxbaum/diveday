import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { MIN_MAIN_TEXT, SKELETON_SELECTOR } from "./screenshot-guards.mjs";

/**
 * **The screenshot guard, held to the two skeleton idioms that actually exist.**
 *
 * `node scripts/screenshot.mjs /pricing /about` reported success and wrote two
 * PNGs of nothing but grey bars. The selector was `main .animate-pulse` — a
 * *descendant* combinator — and six `loading.tsx` files put the class on the
 * `<main>` element itself, so `waitForFunction` resolved on the first tick and
 * the shutter fired on the skeleton (issue #783).
 *
 * The failure mode is the reason this file exists: the tool **exited 0**. A
 * missing screenshot is recoverable; a wrong one a session then reasons from is
 * not, and AGENTS.md points at this script for the "*look at* UI you changed"
 * rule — so a silent wrong answer here is a hole in the one verification step
 * meant to catch what tests cannot.
 *
 * These assertions are DOM-level rather than end-to-end on purpose. The bug is
 * a race in production — the skeleton is only on screen while the body streams
 * — so a browser test would pass or fail on timing, which is exactly the
 * property that let this survive. A selector either matches a shape or it does
 * not.
 */

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const matches = (html) => Boolean(new JSDOM(html).window.document.querySelector(SKELETON_SELECTOR));

describe("the skeleton selector", () => {
  it("sees a pulse on the <main> element itself", () => {
    // The marketing and legal idiom: the whole body pulses as one. This is the
    // shape that was invisible, and the one a `main .animate-pulse` selector
    // cannot match however carefully it is written.
    expect(matches('<main class="flex-1 animate-pulse"><div class="h-4"></div></main>')).toBe(true);
  });

  it("sees a pulse on a wrapper inside <main>", () => {
    // The staff and diver idiom, which always worked.
    expect(matches('<main><div class="animate-pulse"><div class="h-4"></div></div></main>')).toBe(
      true,
    );
  });

  it("ignores a live pulse that is part of the page, in either position", () => {
    // `RecapMap`'s marker and `RollCallNote`'s save dot pulse for as long as
    // they are on screen. Waiting for those to stop would hang forever, so both
    // halves of the selector carry the escape — and a regression that drops it
    // from one half is why this asserts both.
    expect(matches('<main data-live-pulse class="animate-pulse"><p>x</p></main>')).toBe(false);
    expect(matches('<main><span data-live-pulse class="animate-pulse"></span></main>')).toBe(false);
  });

  it("says nothing about a page with no skeleton at all", () => {
    expect(matches("<main><h1>One flat price for the whole shop.</h1></main>")).toBe(false);
  });
});

describe("every loading.tsx this repo ships", () => {
  /** Each `loading.tsx`, and whether its `animate-pulse` sits on `<main>`. */
  function loadingFiles() {
    const found = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "loading.tsx") {
          const source = readFileSync(full, "utf8");
          found.push({
            file: path.relative(REPO, full),
            onMain: /<main[^>]*className="[^"]*animate-pulse/.test(source),
            anywhere: source.includes("animate-pulse"),
          });
        }
      }
    };
    walk(path.join(REPO, "src/app"));
    return found;
  }

  it("finds enough of them to be worth asserting on", () => {
    expect(loadingFiles().length).toBeGreaterThan(30);
  });

  /**
   * The regression itself. If the selector goes back to a descendant-only
   * rule, every one of these becomes invisible again — and the tool goes back
   * to reporting success while photographing nothing.
   */
  it("has its skeleton seen by the selector, whichever idiom it chose", () => {
    const onMain = loadingFiles().filter((entry) => entry.onMain);
    // Not "some": this is the shape the bug was about, and a test that passed
    // when the count fell to zero would stop meaning anything.
    expect(onMain.length).toBeGreaterThanOrEqual(6);
    for (const entry of onMain) {
      expect(matches('<main class="flex-1 animate-pulse"><div></div></main>'), entry.file).toBe(
        true,
      );
    }
  });

  /**
   * The pages the class rule cannot help with — the account-lifecycle shells.
   * They are why the text floor exists: for these the wait is satisfied
   * instantly whatever is on screen, so "does `<main>` have words in it" is the
   * only question left to ask.
   */
  it("leaves some skeletons the class rule cannot see, which the text floor covers", () => {
    const withoutPulse = loadingFiles().filter((entry) => !entry.anywhere);
    expect(withoutPulse.length).toBeGreaterThan(0);
    expect(MIN_MAIN_TEXT).toBeGreaterThan(0);
  });
});
