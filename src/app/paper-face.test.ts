// @vitest-environment jsdom
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * **Paper is one face** (issue #2745).
 *
 * Every printed document is a run of `PaperSheet`s, and a sheet wears its own
 * face on screen and on paper alike: its tokens are ink on white, and nothing
 * inside it draws a fill, a shadow or an edge bar. There is no print face for
 * a screen: no token repaint, no font-size step, no fill strip, and no
 * component that wears a `print:` variant. This reads the rules and asks the
 * DOM what they match, because a selector read as a string cannot say what
 * `:not()` makes of it.
 */
const CSS = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, prelude, body]) => ({
  selector: (prelude ?? "").trim().replace(/\s+/g, " "),
  body: body ?? "",
}));

/** The bodies of every `@media print` block, nested braces included. */
function printBlocks(css: string): string[] {
  const blocks: string[] = [];
  for (const match of css.matchAll(/@media print\s*\{/g)) {
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
  }
  return blocks;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the paper face", () => {
  it("leaves no packet backstop and no print face for a screen", () => {
    expect(CSS).not.toMatch(/trip-print-bundle|print-bundle-page|data-paper-screen/);
    const print = printBlocks(CSS).join("\n");
    // The repaint, the font-size step and the fill strip are gone.
    expect(print).not.toMatch(/--(?:primary|foreground|background|surface|danger)\s*:/);
    expect(print).not.toMatch(/(?:^|[\s,}])html\s*\{/);
    expect(print).not.toMatch(/(?:^|[{}])\s*\*,\s*\*::before/);
    expect(print).not.toMatch(/button\[type="submit"\]/);
    expect(print).not.toMatch(/data-trip-details-paper|data-sticky-actions|data-print-content/);
  });

  it("never asks a printer for exact colour, and a sheet's face is ink on white", () => {
    expect(CSS).not.toMatch(/print-color-adjust:\s*exact/);
    const face = rules.find(
      (rule) => rule.selector === ".paper-sheet" && /--sheet-ink/.test(rule.body),
    );
    expect(face?.body).toMatch(/print-color-adjust:\s*economy/);
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

  it("draws no fill or shadow inside a sheet, on screen as on paper", () => {
    const strip = rules.find((rule) => rule.selector.startsWith(".paper-sheet *,"));
    expect(strip, "the sheet's own strip, outside any media query").toBeDefined();
    expect(strip?.body).toMatch(/background:\s*transparent/);
    expect(strip?.body).toMatch(/box-shadow:\s*none/);
    expect(strip?.body).toMatch(/text-shadow:\s*none/);
    for (const block of printBlocks(CSS)) {
      expect(block, "the strip is not a print rule").not.toContain(".paper-sheet *,\n");
    }
    document.body.innerHTML = `<div class="card">screen</div>
      <section class="paper-sheet"><p class="bg-danger-tint">row</p></section>`;
    const selector = strip?.selector.split(",")[0] ?? "x";
    expect(document.querySelector(".card")?.matches(selector)).toBe(false);
    expect(document.querySelector(".bg-danger-tint")?.matches(selector)).toBe(true);
  });

  it("draws a thick edge bar on a sheet as nothing, and critical information as an outline", () => {
    document.body.innerHTML = `<section class="paper-sheet"><li class="border-l-4 border-danger">row</li>
      <li class="border-s-2">row</li></section><li id="screen" class="border-l-4">screen</li>`;
    const bar = rules.find((rule) => /border-l-4/.test(rule.selector));
    expect(bar?.body).toMatch(/border-inline-start-width:\s*0/);
    for (const element of document.querySelectorAll(".paper-sheet li")) {
      expect(element.matches(bar?.selector ?? "x"), element.outerHTML).toBe(true);
    }
    expect(document.getElementById("screen")?.matches(bar?.selector ?? "x")).toBe(false);
    const critical = rules.find((rule) => rule.selector === ".paper-sheet [data-print-critical]");
    expect(critical?.body).toMatch(/border:\s*2px solid/);
    expect(critical?.body).not.toMatch(/background/);
  });

  it("prints a page that holds a sheet as its sheets, and nothing of its screen", () => {
    const only = rules.find(
      (rule) =>
        rule.selector.startsWith("body:has(.paper-sheet-frame") &&
        /display:\s*none\s*!important/.test(rule.body),
    );
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
    // A sheet's ancestors stop being a layout: no padding, grid or ground.
    const around = rules.find(
      (rule) =>
        rule.selector.includes(":has(.paper-sheet-frame") && /padding-inline/.test(rule.body),
    );
    expect(document.getElementById("screen-around")?.matches(around?.selector ?? "x")).toBe(true);
    expect(document.body.matches(around?.selector ?? "x"), "the body keeps its margin").toBe(false);
    // A page with no sheet is not a document: the rule leaves it alone.
    document.body.innerHTML = `<header id="chrome">Menu</header><main>Screen</main>`;
    expect(document.getElementById("chrome")?.matches(selector)).toBe(false);
  });

  it("ignores a sheet kept alive on a hidden route, so the page on screen still prints", () => {
    // Cache Components keeps a page you left mounted under `display: none`
    // (#2745 dock-operator review): the Boat tab's sheet must not blank Prep.
    const only = rules.find((rule) => rule.selector.startsWith("body:has(.paper-sheet-frame"));
    const around = rules.find((rule) => /padding-inline/.test(rule.body));
    document.body.innerHTML = `<main id="prep">Prep</main>
      <div id="kept" style="display: none"><div class="paper-sheet-frame" data-paper-print-only=""><div>
      <section class="paper-sheet">Manifest</section></div></div></div>`;
    expect(document.getElementById("prep")?.matches(only?.selector ?? "")).toBe(false);
    expect(document.getElementById("kept")?.matches(around?.selector ?? "x")).toBe(false);
  });

  it("gives a sheet no background of its own except the ground", () => {
    for (const rule of rules.filter((r) =>
      /\.paper-sheet(-band|-mark|-frame)?\s*$/.test(r.selector),
    )) {
      const fills = [...rule.body.matchAll(/(?:^|[;\s])background(?:-color)?:\s*([^;]+);/g)];
      for (const [, value = ""] of fills) {
        expect(value.trim(), rule.selector).toMatch(
          /^(var\(--sheet-ground\)|var\(--surface-sunken\)|none)$/,
        );
      }
    }
  });

  it("leaves no component wearing a second face for paper", () => {
    // A `print:` variant is a screen dressing for a printer that never sees it.
    let output = "";
    try {
      output = execFileSync(
        "git",
        ["grep", "-n", "-E", String.raw`(^|[\s"'\x60{])print:[a-z\[&!-]`, "--", "src"],
        { cwd: path.join(import.meta.dirname, "..", ".."), encoding: "utf8" },
      );
    } catch (error) {
      // `git grep` exits 1 when nothing matches, which is the pass.
      if ((error as { status?: number }).status !== 1) throw error;
    }
    const found = output
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.startsWith("src/app/paper-face.test.ts"));
    expect(found).toEqual([]);
  }, 20_000);
});
