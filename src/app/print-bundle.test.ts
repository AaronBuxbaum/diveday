// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * **The packet's backstop hides controls, never the facts a control carries.**
 *
 * `globals.css` hides every button, select, textarea and input inside
 * `.trip-print-bundle`, so a section that grows a "Cancel trip" button cannot
 * print it beside a roster (issue #814). The roll call's rows are buttons too:
 * the person's name is the trigger that opens their sheet. Under the blanket
 * rule both packets printed 9 diver rows and 2 crew rows with no names in
 * them (pixel probe, `trip-packet-print` and `day-packet-print`).
 *
 * A button whose content *is* the fact says so with `data-print-content`, and
 * the rule lets it through. What that trigger carries is pinned where it is
 * rendered (`DiverRollCall.test.tsx`); this reads the rule itself and asks the
 * DOM which elements it matches, because a selector read as a string cannot
 * say what `:is()` and `:not()` make of it.
 */
const CSS = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The innermost rule whose selector names the bundle and whose body hides it. */
const backstop = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, prelude, body]) => ({ selector: (prelude ?? "").trim(), body: body ?? "" }))
  .find(
    (rule) => rule.selector.startsWith(".trip-print-bundle") && /display:\s*none/.test(rule.body),
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the packet's print backstop", () => {
  it("exists, as one rule on the bundle", () => {
    expect(backstop, "a `.trip-print-bundle … { display: none }` rule").toBeDefined();
  });

  it("still hides every bare control", () => {
    document.body.innerHTML = `<div class="trip-print-bundle"><section>
      <button type="button">Cancel trip</button><input /><select></select><textarea></textarea>
    </section></div>`;
    const selector = backstop?.selector ?? ":not(*)";
    for (const control of document.querySelectorAll("button, input, select, textarea")) {
      expect(control.matches(selector), control.outerHTML).toBe(true);
    }
  });

  it("prints a button that declares its content is the fact", () => {
    document.body.innerHTML = `<div class="trip-print-bundle"><ol><li>
      <button type="button" data-print-content>01 Meera Iyer</button>
    </li></ol></div>`;
    const trigger = document.querySelector("button");
    expect(trigger?.matches(backstop?.selector ?? "*")).toBe(false);
  });
});

/**
 * **A primary label prints in ink** (K-141). Print strips every fill
 * (`background: transparent !important`) but the print palette kept
 * `--primary-foreground: #ffffff`, so a label written for a primary fill
 * printed white on white paper: the manifest's current stage was a hole the
 * width of its word. With the fill gone, the label is ink like every other.
 */
describe("the print palette", () => {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, prelude, body]) => ({
    selectors: (prelude ?? "").trim().split(/\s*,\s*/),
    body: body ?? "",
  }));
  const palette = rules.find(
    (rule) => rule.selectors.includes(":root") && rule.selectors.includes(".boat-mode"),
  );

  function token(name: string) {
    return palette?.body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  }

  it("prints a primary label in the foreground ink", () => {
    expect(palette, "the print `:root, .boat-mode` palette").toBeDefined();
    expect(token("foreground")).toBeDefined();
    expect(token("primary-foreground")).toBe(token("foreground"));
  });
});
