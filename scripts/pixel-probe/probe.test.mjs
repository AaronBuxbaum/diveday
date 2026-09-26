import { describe, expect, it } from "vitest";
import { stateCandidates } from "./probe.mjs";

/**
 * Which elements the state pass forces, and into which states.
 *
 * The pass itself needs a browser (`e2e/pixel-probe.spec.ts` drives it); the
 * choice of what to force is plain data, and is held here.
 */

const EL = {
  p: -1,
  cp: -1,
  tag: "button",
  role: "",
  type: "",
  cls: "btn",
  label: "",
  x: 0,
  y: 0,
  w: 120,
  h: 44,
  pos: "static",
  bw: [0, 0, 0, 0],
  rad: [0, 0, 0, 0],
  bg: false,
  shadow: false,
  clips: false,
  op: 1,
  vis: "visible",
  srOnly: false,
  interactive: true,
  focusable: true,
  disabled: false,
  ti: null,
};

function snapshotOf(elements) {
  return { elements: elements.map((el, i) => ({ ...EL, i, ...el })) };
}

describe("state candidates", () => {
  it("hovers an option no keyboard focuses, and never forces focus on it", () => {
    // The command palette's `tabindex="-1"` results: a pointer hovers them,
    // but focus stays in the combobox, so a forced `:focus-visible` on one is
    // a state the page cannot reach.
    const { candidates, hoverOnly } = stateCandidates(
      snapshotOf([
        { cls: "option", role: "option", ti: -1 },
        { cls: "save", y: 60 },
      ]),
    );
    expect(candidates).toEqual([0, 1]);
    expect([...hoverOnly]).toEqual([0]);
  });
});
