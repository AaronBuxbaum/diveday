// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { baseLayerRules, type CssBlock, readGlobalsCss, unlayeredRules } from "@/test/stylesheet";

/**
 * **Glare mode's 44px targets are a floor, never a ceiling.**
 *
 * `.glare-mode` (the crew's high-contrast skin, and the diver's on the bearer
 * pages) promises every target at least 44px. It said so with
 * `min-height: 44px !important`, unlayered, and an important declaration beats
 * every utility — so it replaced every *larger* minimum too. The roll call's
 * person button is `min-h-19`, 76px, and in Boat mode it rendered at 52px:
 * names and their index rode 11–13px above the centre of the 56px mark beside
 * them (pixel probe, `manifest-seen-boat-mode` and `manifest-glare`). In
 * `@layer base` and without `!important`, an element with no minimum of its
 * own still gets 44px and a component that asks for more keeps it.
 *
 * **And the prose-link reset leaves tap targets alone.** Links inside a
 * sentence go back to `display: inline` so glare does not break a paragraph
 * into boxes. The reset matched `span a`, and `EyebrowBackLink` is an
 * `inline-flex min-h-11` link in a `<span>`: it rendered inline at 33×28, its
 * chevron on a line of its own above "TRIP". A link that is already a tap
 * target (`inline-flex`) is not prose.
 *
 * jsdom has no layout, so this reads the rules and asks the DOM what their
 * selectors match. The probe measures the rows.
 */
const CSS = readGlobalsCss();
const layerBase = baseLayerRules(CSS);

const glareRules = (rules: CssBlock[]) =>
  rules.filter((rule) => rule.prelude.includes(".glare-mode"));

afterEach(() => {
  document.documentElement.className = "";
  document.body.innerHTML = "";
});

describe("glare mode's 44px floor", () => {
  const floor = glareRules(layerBase).find(
    (rule) => /min-height:\s*44px/.test(rule.body) && /min-width:\s*44px/.test(rule.body),
  );

  it("lives in @layer base, so a component's larger minimum wins", () => {
    expect(floor, "a .glare-mode min-height/min-width 44px rule inside @layer base").toBeDefined();
    expect(floor?.body).not.toContain("!important");
  });

  it("is not forced a second time from outside the layer", () => {
    const forced = glareRules(unlayeredRules(CSS)).filter((rule) =>
      /min-(height|width):\s*44px/.test(rule.body),
    );
    expect(forced.map((rule) => rule.prelude)).toEqual([]);
  });

  it("reaches every control and link a finger lands on", () => {
    document.documentElement.className = "glare-mode";
    document.body.innerHTML = `<main>
      <button>b</button><select></select><textarea></textarea><input type="text" />
      <details><summary>s</summary></details><div role="button">r</div><a href="/">a</a>
      <input type="hidden" id="hidden" />
    </main>`;
    const selector = floor?.prelude ?? ":not(*)";
    for (const target of document.querySelectorAll(
      "button, select, textarea, input:not([type=hidden]), summary, [role=button], a",
    )) {
      expect(target.matches(selector), target.outerHTML).toBe(true);
    }
    expect(document.getElementById("hidden")?.matches(selector)).toBe(false);
  });
});

describe("glare mode's prose-link reset", () => {
  const reset = glareRules(unlayeredRules(CSS)).find((rule) =>
    /display:\s*inline\s*!important/.test(rule.body),
  );

  it("puts a link in a sentence back inline", () => {
    expect(reset, "a .glare-mode rule setting display: inline !important").toBeDefined();
    document.documentElement.className = "glare-mode";
    document.body.innerHTML = `<p>Read <a href="/terms">the terms</a> first.</p>`;
    expect(document.querySelector("a")?.matches(reset?.prelude ?? "*")).toBe(true);
  });

  it("leaves a tap-target link inside a span its box (the eyebrow back link)", () => {
    document.documentElement.className = "glare-mode";
    document.body.innerHTML = `<p><span><a class="inline-flex min-h-11 items-center" href="/board">Trip</a></span></p>`;
    expect(document.querySelector("a")?.matches(reset?.prelude ?? "*")).toBe(false);
  });
});
