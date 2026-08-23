import { describe, expect, it } from "vitest";

/**
 * The check's judgement, not its plumbing. It shipped matching `/10` only, on
 * the argument that the `/15` family mostly rendered under `.boat-mode` and a
 * grep could not tell which. Measured (issue #874), that was right about the
 * palette and wrong about the remedy: boat-mode is compliant at 15% (4.98:1
 * worst case) while one app-palette line sat at 4.33:1 — invisible to the
 * narrow pattern.
 */
const FILL = (hue) => new RegExp(`bg-${hue}\\/\\d+\\b`);
const INK = (hue) => new RegExp(`text-${hue}(-strong)?\\b`);

const flags = (hue, text) => FILL(hue).test(text) && INK(hue).test(text);

describe("what the tinted-ink check flags", () => {
  it("catches every opacity, not only the canonical 10%", () => {
    for (const fill of ["bg-danger/5", "bg-danger/10", "bg-danger/15", "bg-danger/20"]) {
      expect(flags("danger", `${fill} text-danger`), fill).toBe(true);
    }
  });

  it("catches it behind a variant, which is where the hover states live", () => {
    expect(flags("danger", "text-danger hover:bg-danger/10")).toBe(true);
    expect(flags("danger", "peer-checked:bg-danger/15 peer-checked:text-danger")).toBe(true);
  });

  it("leaves an opaque tint alone — that is the fix, not the defect", () => {
    expect(flags("success", "bg-success-tint text-success-strong")).toBe(false);
  });

  /**
   * A fill of one hue under ink of another is the *nastier* version of this
   * bug — a `bg-primary/10` badge on a green row was the worst ratio in the app
   * — but it is not same-element, so this check does not claim it. The axe scan
   * is what covers that.
   */
  it("does not claim a mismatched pair it cannot reason about", () => {
    expect(flags("primary", "bg-primary/10 text-success")).toBe(false);
    expect(flags("success", "bg-primary/10 text-success")).toBe(false);
  });

  /**
   * The opaque token starts with the same eleven characters as the fill it
   * replaces, so an unanchored pattern would flag the fix as the defect. `\d+`
   * after the slash is what tells them apart.
   */
  it("does not match the opaque token, which starts the same way", () => {
    expect(flags("success", "bg-success-tint text-success-strong")).toBe(false);
    expect(flags("danger", "bg-surface/90 text-muted")).toBe(false);
  });
});
