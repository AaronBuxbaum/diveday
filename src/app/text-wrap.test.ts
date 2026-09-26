// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { baseLayerRules, declarations, readGlobalsCss } from "@/test/stylesheet";

/**
 * **Running text never ends on one word.**
 *
 * About a dozen files opted into `text-pretty` by hand, and everything else —
 * the trip pages, the thread's steps, `/ready`, the packing lists, the waiver
 * copy, the marketing leads ("…all four of / them.") — left one-word last
 * lines (pixel probe, 18 captures). One base-layer rule gives every paragraph,
 * list item, definition and caption the pretty wrap; `text-balance` and every
 * other utility still win.
 *
 * **The longhand, `text-wrap-style`, and never the `text-wrap` shorthand.**
 * The shorthand also sets `text-wrap-mode: wrap`, so on a `<p>` inside a
 * `truncate` or `whitespace-nowrap` parent it would undo the `nowrap` the
 * paragraph inherits and break the ellipsis. The longhand only chooses where a
 * line that was going to wrap anyway breaks.
 */
const rule = baseLayerRules(readGlobalsCss()).find(
  (candidate) => declarations(candidate.body)["text-wrap-style"] === "pretty",
);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the pretty wrap", () => {
  it("is set once, in @layer base, with the longhand", () => {
    expect(rule, "a text-wrap-style: pretty rule inside @layer base").toBeDefined();
    expect(declarations(rule?.body ?? "")).not.toHaveProperty("text-wrap");
  });

  it("reaches paragraphs, list items, definitions and captions", () => {
    document.body.innerHTML = `<main>
      <p>para</p><ul><li>item</li></ul><dl><dt>t</dt><dd>def</dd></dl>
      <figure><figcaption>cap</figcaption></figure>
    </main>`;
    for (const target of document.querySelectorAll("p, li, dd, figcaption")) {
      expect(target.matches(rule?.prelude ?? ":not(*)"), target.tagName).toBe(true);
    }
  });
});
