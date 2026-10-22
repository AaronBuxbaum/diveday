import { describe, expect, it } from "vitest";
import { buttonClass } from "./button";

const UNPAINTED_VARIANTS = ["link", "bare"] as const;

describe("buttonClass padded flush", () => {
  it("keeps symmetric target room around a short unpainted flush label", () => {
    for (const variant of UNPAINTED_VARIANTS) {
      for (const size of ["sm", "md", "boat"] as const) {
        const classes = buttonClass({ variant, size, flush: "padded" }).split(/\s+/);
        expect(classes.filter((token) => /^(?:[\w.-]+:)*-?px-/.test(token))).toEqual(["px-2"]);
        expect(classes, `${variant}/${size}`).toContain("-mx-2");
        expect(classes, `${variant}/${size}`).toContain("min-h-11");
        expect(classes.filter((token) => /^(?:[\w-]+:)*bg-/.test(token))).toEqual([]);
      }
    }
  });

  it("leaves unpadded sizes unchanged in padded-flush mode", () => {
    for (const variant of UNPAINTED_VARIANTS) {
      for (const size of ["icon", "icon-sm", "mark"] as const) {
        expect(buttonClass({ variant, size, flush: "padded" })).toBe(
          buttonClass({ variant, size }),
        );
      }
    }
    // @ts-expect-error — padded flush is for an unpainted label, not a hover fill.
    buttonClass({ variant: "ghost", flush: "padded" });
    // @ts-expect-error — a painted variant lines up by its box.
    buttonClass({ variant: "primary", flush: "padded" });
  });
});
