// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { baseLayerRules, declarations, readGlobalsCss } from "@/test/stylesheet";

/**
 * **Every button shows the hand, not only the ones spelled with `buttonClass`.**
 *
 * Tailwind v4's Preflight stopped giving `<button>` a pointer cursor, and the
 * app put it back one class string at a time: `buttonClass`'s base carries
 * `cursor-pointer`, and every button written by hand — the check-in queue's
 * rows, the language choices, the command palette's options, the staff-roles
 * disclosure, a trip's public actions — showed the arrow (pixel probe, state
 * atlas). One base-layer rule gives every enabled button, summary and ARIA
 * button the hand; a utility (`disabled:cursor-wait`) still wins, and a
 * disabled button keeps the arrow.
 */
const rule = baseLayerRules(readGlobalsCss()).find(
  (candidate) => declarations(candidate.body).cursor === "pointer",
);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the pointer cursor", () => {
  it("is set once, in @layer base, so any utility can still change it", () => {
    expect(rule, "a cursor: pointer rule inside @layer base").toBeDefined();
  });

  it("reaches every enabled button, summary and ARIA button", () => {
    document.body.innerHTML = `<main>
      <button type="button">Seat</button>
      <details><summary>More</summary></details>
      <div role="button" tabindex="0">Pick</div>
    </main>`;
    for (const target of document.querySelectorAll("button, summary, [role=button]")) {
      expect(target.matches(rule?.prelude ?? ":not(*)"), target.outerHTML).toBe(true);
    }
  });

  it("leaves a disabled button the arrow", () => {
    document.body.innerHTML = `<button type="button" disabled>Seat</button>`;
    expect(document.querySelector("button")?.matches(rule?.prelude ?? "*")).toBe(false);
  });
});
