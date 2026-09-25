import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";
import { collectGeometry } from "./collect.mjs";
import { __test__ as states } from "./states.mjs";

/**
 * **The functions that run inside the page must not reach outside it.**
 *
 * `collectGeometry` is serialised by `page.evaluate` and the state pass's
 * helpers by CDP's `Runtime.callFunctionOn`: their *source text* crosses the
 * boundary, and nothing they close over does. `scripts/screenshot.test.mjs`
 * exists because `screenshot.mjs` once closed over a module `const` in exactly
 * this position and threw a `ReferenceError` on every route.
 *
 * So each function is rebuilt here from its source text inside a fresh jsdom
 * window's own `Function` — a realm with the DOM globals and nothing of this
 * module — and run. A reference to anything the function did not declare fails
 * the test the same way it would fail in Chromium.
 *
 * jsdom has no layout, so every box measures zero; the point is that the
 * function runs to completion and returns the shape the analysis reads, not
 * what it measures.
 */

function freshWindow(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    // jsdom reports `canvas.getContext` as not implemented; the collector
    // already treats a missing context as "no font metrics".
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  // Layout APIs jsdom does not implement. These are the platform's, not the
  // module's: the test still fails on any identifier the source leans on.
  window.Range.prototype.getClientRects ??= () => [];
  window.Range.prototype.getBoundingClientRect ??= () => new window.DOMRect(0, 0, 0, 0);
  return window;
}

/** Rebuild a function from its source inside the window's realm. */
function inWindow(window, fn) {
  return new window.Function(`return (${fn.toString()});`)();
}

describe("collectGeometry, rebuilt from its own source", () => {
  // jsdom does not expand the `overflow` shorthand, so the card spells out
  // both longhands.
  const html = `
    <main class="px-4">
      <div class="card rounded-panel overflow-hidden" style="overflow-x:hidden;overflow-y:hidden">
        <a href="/x" class="row">Team <span class="sr-only">settings</span></a>
        <button class="btn" disabled>Save</button>
      </div>
      <svg class="icon"><path d="M0 0"/></svg>
      <script>ignored()</script>
    </main>`;

  it("runs with nothing but the page's own globals", () => {
    const window = freshWindow(html);
    const collect = inWindow(window, collectGeometry);
    const snapshot = collect({});
    expect(snapshot.elements.length).toBeGreaterThan(3);
    const tags = snapshot.elements.map((el) => el.tag);
    expect(tags).toContain("a");
    expect(tags).toContain("svg");
    // An SVG's children and a script are never walked.
    expect(tags).not.toContain("path");
    expect(tags).not.toContain("script");
  });

  it("records the facts the analysis reads", () => {
    const window = freshWindow(html);
    const snapshot = inWindow(window, collectGeometry)({});
    const link = snapshot.elements.find((el) => el.tag === "a");
    expect(link).toMatchObject({ focusable: true, interactive: true, cls: "row" });
    const card = snapshot.elements.find((el) => el.cls.startsWith("card"));
    expect(card.clips).toBe(true);
    expect(link.cp).toBe(card.i);
    expect(snapshot.elements.find((el) => el.cls === "sr-only").srOnly).toBe(true);
    expect(snapshot.elements.find((el) => el.tag === "button").disabled).toBe(true);
    expect(snapshot).toHaveProperty("doc.scrollWidth");
    expect(snapshot).toHaveProperty("pageBg");
  });

  it("survives a form whose named input clobbers its own properties", () => {
    const window = freshWindow(
      `<form class="f"><input name="id" value="1"><input name="className" value="x"><button>Go</button></form>`,
    );
    const snapshot = inWindow(window, collectGeometry)({});
    const form = snapshot.elements.find((el) => el.tag === "form");
    expect(form.id).toBe("");
    expect(form.cls).toBe("f");
  });

  it("records a tabindex, so an option focus never reaches is known as one", () => {
    // The command palette's results: `<button role="option" tabindex="-1">`
    // under an input that keeps focus and moves `aria-activedescendant`.
    const window = freshWindow(
      `<div role="listbox"><button class="opt" role="option" tabindex="-1">Tuesday</button></div>
       <button class="plain">Save</button><div class="stop" tabindex="0">Map</div>`,
    );
    const snapshot = inWindow(window, collectGeometry)({});
    const byCls = (cls) => snapshot.elements.find((el) => el.cls === cls);
    // Still a control and still a target — only not a tab stop.
    expect(byCls("opt")).toMatchObject({ ti: -1, focusable: true, interactive: true });
    expect(byCls("plain").ti).toBeNull();
    expect(byCls("stop")).toMatchObject({ ti: 0, focusable: true });
  });

  it("puts back the one style it lifts", () => {
    const window = freshWindow(html);
    window.document.body.style.overflowX = "clip";
    inWindow(window, collectGeometry)({});
    expect(window.document.body.style.overflowX).toBe("clip");
  });

  it("hands back the live elements at the indices it numbered", () => {
    const window = freshWindow(html);
    const collect = inWindow(window, collectGeometry);
    const snapshot = collect({});
    const at = snapshot.elements.find((el) => el.tag === "button").i;
    const [element] = collect({ pick: [at] });
    expect(element.tagName).toBe("BUTTON");
  });
});

describe("the state pass's page-side helpers, rebuilt from their own source", () => {
  it("measure an element with nothing but the page's globals", () => {
    const window = freshWindow(`<div class="card"><a href="/x" class="row">Team</a></div>`);
    const measure = inWindow(window, states.measureElementState);
    const link = window.document.querySelector("a");
    // jsdom's selector engine may not know `:focus-visible`; the helper's job
    // here is only to reach the call, so a SyntaxError from the engine is the
    // engine's, and anything else is ours.
    try {
      const snapshot = measure.call(link);
      expect(snapshot).toHaveProperty("rel");
      expect(snapshot.rel[0].k).toBe("self");
    } catch (error) {
      expect(String(error)).toMatch(/SyntaxError|not a valid selector|focus-visible/);
    }
  });

  it("flatten and chain an element's ancestors the same way", () => {
    const window = freshWindow(`<div><p><a href="/x">A</a></p><span>B</span></div>`);
    const flatten = inWindow(window, states.flattenWithAncestors);
    const chains = inWindow(window, states.ancestorChains);
    const picked = [window.document.querySelector("a"), window.document.querySelector("span")];
    const all = flatten.call(picked);
    const map = chains.call(picked);
    expect(all[map[0][0]].tagName).toBe("A");
    expect(all[map[1][0]].tagName).toBe("SPAN");
    // The shared ancestors are listed once and chained by index.
    expect(map[0].at(-1)).toBe(map[1].at(-1));
  });
});
