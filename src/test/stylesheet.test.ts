import { describe, expect, it } from "vitest";
import { baseLayerRules, declarations, topLevelBlocks, unlayeredRules } from "./stylesheet";

describe("stylesheet parser helpers", () => {
  it("keeps quoted braces, comment markers and semicolons inside their CSS values", () => {
    const css = `
      @import "tokens;more.css";
      .quoted {
        content: "close } ; /* literal comment */";
        --data: url("data:image/svg+xml;utf8,<svg>{}</svg>");
        color: red /* comment */ blue !important;
      }
    `;

    expect(topLevelBlocks(css).map(({ prelude }) => prelude)).toEqual([".quoted"]);
    expect(declarations(topLevelBlocks(css)[0]?.body ?? "")).toEqual({
      content: '"close } ; /* literal comment */"',
      "--data": 'url("data:image/svg+xml;utf8,<svg>{}</svg>")',
      color: "red blue !important",
    });
  });

  it("recurses only through the allowlisted conditional rules when finding unlayered rules", () => {
    const css = `
      @media print {
        .media { color: black; }
        @supports (display: grid) { .supports { display: grid; } }
        .nested { & .child { color: red; } }
      }
      @container card (min-width: 20rem) { .container { display: block; } }
      @layer base { .base { color: blue; } }
      @layer utilities { .utility { color: green; } }
      @unknown { .unknown { color: purple; } }
    `;

    expect(unlayeredRules(css).map(({ prelude }) => prelude)).toEqual([
      ".media",
      ".supports",
      ".nested",
      ".container",
    ]);
  });

  it("keeps base-layer selection at the direct child level", () => {
    const css = `
      @layer base {
        .base { color: blue; }
        @media print { .conditional { color: black; } }
      }
      @layer utilities { .utility { color: green; } }
      @layer  base { .not-exact { color: red; } }
    `;

    expect(baseLayerRules(css).map(({ prelude }) => prelude)).toEqual([".base", "@media print"]);
  });

  it("reads declarations from direct children and normalizes whitespace", () => {
    expect(
      declarations(`
        --complex: var(--fallback, rgb(0 0 0 / 50%));
        content: "semi; colon: { brace }";
        color: red  blue !important;
      `),
    ).toEqual({
      "--complex": "var(--fallback, rgb(0 0 0 / 50%))",
      content: '"semi; colon: { brace }"',
      color: "red blue !important",
    });
  });

  it("does not report nested media and variant declarations as direct properties", () => {
    const block = topLevelBlocks(`
      .chip-scroller {
        overflow-x: auto;
        @media (max-width: 40rem) { mask-image: linear-gradient(to right, black, transparent); }
        @variant max-sm { scroll-snap-type: x mandatory; }
      }
    `)[0];

    expect(declarations(block?.body ?? "")).toEqual({ "overflow-x": "auto" });
  });
});
