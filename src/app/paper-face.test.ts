// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * **Paper is one face** (issue #2745).
 *
 * Every printed document is a run of `PaperSheet`s, and a sheet wears its own
 * tokens on screen and on paper alike, and those tokens are ink on white. The
 * print stylesheet's fill strip covers a sheet as well as a screen (the net
 * under the tokens), with no `!important` restore under it, and no packet
 * backstop hiding controls, because a sheet renders none. This reads the rules and asks the DOM what
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

  it("strips every fill for print, a sheet's included", () => {
    expect(strip, "the print block's fill strip").toBeDefined();
    document.body.innerHTML = `<main><div class="card">screen</div>
      <section class="paper-sheet"><div class="paper-sheet-band">band</div>
      <p class="bg-danger-tint">row</p></section></main>`;
    const first = firstSelector(strip?.selector ?? "*");
    for (const element of document.querySelectorAll(".card, .paper-sheet, .paper-sheet *")) {
      expect(element.matches(first), element.outerHTML).toBe(true);
    }
    // Ink-light paper (`.claude/rules/print-ink.md`): the strip also drops
    // shadows (a ring is one) and asks the browser for economy ink.
    expect(strip?.body).toMatch(/box-shadow:\s*none\s*!important/);
    expect(strip?.body).toMatch(/print-color-adjust:\s*economy/);
  });

  it("never asks a printer for exact colour, and a sheet's face is ink on white", () => {
    expect(CSS).not.toMatch(/print-color-adjust:\s*exact/);
    const face = rules.find(
      (rule) => rule.selector === ".paper-sheet" && /--sheet-ink/.test(rule.body),
    );
    const tokens = [...(face?.body ?? "").matchAll(/--sheet-[a-z]+:\s*(#[0-9a-f]{6})/g)];
    expect(tokens.length).toBeGreaterThan(0);
    for (const [, hex = ""] of tokens) {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      expect(r === g && g === b, `${hex} is grey, not a hue`).toBe(true);
    }
    // Every status token on the sheet is ink or white: no hue, no tint.
    for (const [, name, value] of (face?.body ?? "").matchAll(
      /--((?:success|warning|danger|info|primary|accent)[a-z-]*):\s*([^;]+);/g,
    )) {
      expect(value, `--${name}`).toMatch(/^var\(--sheet-(ink|ground)\)$/);
    }
    expect(CSS).not.toMatch(/--sheet-band/);
  });

  it("draws a thick edge bar as nothing, and critical information as an outline", () => {
    document.body.innerHTML = `<li class="border-l-4 border-danger">row</li>
      <li class="border-s-2">row</li>`;
    const bar = rules.find((rule) => /border-l-4/.test(rule.selector));
    expect(bar?.body).toMatch(/border-inline-start-width:\s*0/);
    for (const element of document.querySelectorAll("li")) {
      expect(element.matches(bar?.selector ?? "x"), element.outerHTML).toBe(true);
    }
    const critical = rules.find((rule) => rule.selector === "[data-print-critical]");
    expect(critical?.body).toMatch(/border:\s*1\.5px solid/);
    expect(critical?.body).not.toMatch(/background/);
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

  it("gives a sheet no background of its own except the ground", () => {
    for (const rule of rules.filter((r) =>
      /\.paper-sheet(-band|-mark|-frame)?\s*$/.test(r.selector),
    )) {
      const fills = [...rule.body.matchAll(/(?:^|[;\s])background(?:-color)?:\s*([^;]+);/g)];
      for (const [, value = ""] of fills) {
        expect(value.trim(), rule.selector).toMatch(
          /^(var\(--sheet-ground\)|var\(--surface-sunken\))$/,
        );
      }
    }
  });
});
