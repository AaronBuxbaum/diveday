// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * **Paper is one face** (issue #2745).
 *
 * Every printed document is a run of `PaperSheet`s, and a sheet wears its own
 * tokens on screen and on paper alike. So the print stylesheet's fill strip,
 * which repaints a *screen* for a mono laser, must leave a sheet alone: no
 * `!important` restore under it, and no packet backstop hiding controls,
 * because a sheet renders none. This reads the rules and asks the DOM what
 * they match, because a selector read as a string cannot say what `:not()`
 * makes of it.
 */
const CSS = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, prelude, body]) => ({
  selector: (prelude ?? "").trim(),
  body: body ?? "",
}));

/** The print block's fill strip: transparent backgrounds, everywhere it applies. */
const strip = rules.find((rule) => /background:\s*transparent\s*!important/.test(rule.body));

/** The first selector of a list, split at a top-level comma (not one inside `:not()`). */
function firstSelector(list: string): string {
  let depth = 0;
  for (const [index, character] of [...list].entries()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) return list.slice(0, index).trim();
  }
  return list.trim();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the paper face", () => {
  it("leaves no packet backstop behind", () => {
    expect(CSS).not.toMatch(/trip-print-bundle|print-bundle-page|data-paper-screen/);
  });

  it("strips a screen's fills for print, never a sheet's", () => {
    expect(strip, "the print block's fill strip").toBeDefined();
    document.body.innerHTML = `<main><div class="card">screen</div>
      <section class="paper-sheet"><div class="paper-sheet-band">band</div>
      <p class="bg-danger-tint">row</p></section></main>`;
    const first = firstSelector(strip?.selector ?? "*");
    expect(document.querySelector(".card")?.matches(first)).toBe(true);
    for (const inside of document.querySelectorAll(".paper-sheet, .paper-sheet *")) {
      expect(inside.matches(first), inside.outerHTML).toBe(false);
    }
  });

  it("prints a page that holds a sheet as its sheets, and nothing of its screen", () => {
    const only = rules.find((rule) => rule.selector.startsWith("body:has(.paper-sheet-frame)"));
    expect(only?.body, "the screen's hide on paper").toMatch(/display:\s*none\s*!important/);
    document.body.innerHTML = `<header id="chrome"><button>Menu</button></header>
      <main id="screen-around"><form id="answers"><input name="birthdate" /></form>
      <div class="paper-sheet-frame" data-paper-print-only=""><div>
      <section class="paper-sheet"><p id="sheet-line">Name</p></section></div></div></main>
      <div id="toast">Saved</div>`;
    const selector = only?.selector ?? "";
    for (const id of ["chrome", "answers", "toast"]) {
      expect(document.getElementById(id)?.matches(selector), id).toBe(true);
    }
    for (const kept of ["#screen-around", ".paper-sheet-frame", ".paper-sheet", "#sheet-line"]) {
      expect(document.querySelector(kept)?.matches(selector), kept).toBe(false);
    }
    // A page with no sheet is not a document: the rule leaves it alone.
    document.body.innerHTML = `<header id="chrome">Menu</header><main>Screen</main>`;
    expect(document.getElementById("chrome")?.matches(selector)).toBe(false);
  });

  it("restores nothing on a sheet with !important", () => {
    for (const rule of rules.filter((r) => /\.paper-sheet(-band|-mark)?\s*$/.test(r.selector))) {
      expect(rule.body, rule.selector).not.toMatch(/background[^;]*!important/);
    }
  });
});
