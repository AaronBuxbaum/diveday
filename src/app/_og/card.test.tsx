// @vitest-environment jsdom
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LOGO_MARK_CIRCLES, LOGO_MARK_VIEWBOX, LogoMark } from "@/components/Logo";
import { OG_COLORS, OG_MARK_SIZE, ogMarkCircles } from "./card";

afterEach(cleanup);

/**
 * The link-preview cards render in someone else's chat window and nowhere
 * else, so nothing in the normal loop — no page, no screenshot, no visual
 * baseline — ever shows a person that the brand mark on them is wrong. That is
 * how a single plain circle stood in for the three-bubble mark on all four
 * cards, and how a 40px-to-48px rescale then landed on one card and left the
 * other three behind, each still individually plausible (FU-20260812).
 *
 * These are the tests that would have caught both: one asserts the mark's
 * pixels are *derived* from the one geometry list rather than typed, and one
 * walks the route tree and refuses any card that draws its own chrome — so a
 * fifth card added tomorrow is covered without anybody remembering to add it
 * here.
 */

const APP = path.join(process.cwd(), "src/app");

async function cardFiles(): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "opengraph-image.tsx" || entry.name === "twitter-image.tsx")
        found.push(full);
    }
  }
  await walk(APP);
  return found.sort();
}

/** Line comments first, then blocks — a `//` mentioning `/*` would otherwise eat the file. */
function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the mark's geometry has one home", () => {
  it("derives the card's bubbles from LogoMark's viewBox coordinates", () => {
    // The 48px box is the 24px viewBox at 2x: a center-and-radius circle
    // becomes a top-left corner and a diameter. These are the numbers the four
    // cards used to carry by hand.
    expect(ogMarkCircles(48)).toEqual([
      { left: 4, top: 24, size: 20, color: OG_COLORS.primary, opacity: 1 },
      { left: 24, top: 11, size: 14, color: OG_COLORS.primary, opacity: 0.75 },
      { left: 35, top: 5, size: 8, color: OG_COLORS.accent, opacity: 1 },
    ]);
    expect(ogMarkCircles()).toEqual(ogMarkCircles(OG_MARK_SIZE));
  });

  it("rescales every bubble together, so a resize cannot land on some of them", () => {
    // The drift that actually happened: the box grew and the circles did not.
    const small = ogMarkCircles(40);
    const large = ogMarkCircles(64);
    expect(small).toHaveLength(LOGO_MARK_CIRCLES.length);
    for (const [index, circle] of small.entries()) {
      expect(large[index].size).toBeGreaterThan(circle.size);
      expect(large[index].left).toBeGreaterThan(circle.left);
    }
    // The largest bubble still sits at the bottom left and the coral one at the
    // top right — the mark ascends at any size.
    expect(large[0].top).toBeGreaterThan(large[2].top);
    expect(large[0].left).toBeLessThan(large[2].left);
    expect(large.at(-1)?.color).toBe(OG_COLORS.accent);
  });

  it("draws the DOM mark from that same list", () => {
    const { container } = render(<LogoMark />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe(`0 0 ${LOGO_MARK_VIEWBOX} ${LOGO_MARK_VIEWBOX}`);
    const circles = [...container.querySelectorAll("circle")].map((circle) => ({
      cx: Number(circle.getAttribute("cx")),
      cy: Number(circle.getAttribute("cy")),
      r: Number(circle.getAttribute("r")),
      fill: circle.getAttribute("fill"),
    }));
    expect(circles).toEqual(
      LOGO_MARK_CIRCLES.map((circle) => ({
        cx: circle.cx,
        cy: circle.cy,
        r: circle.r,
        fill: circle.tone === "accent" ? "var(--accent)" : "currentColor",
      })),
    );
    // The rationed coral is the top bubble and only the top bubble (ADR-0004).
    expect(LOGO_MARK_CIRCLES.filter((circle) => circle.tone === "accent")).toHaveLength(1);
  });
});

describe("every link-preview card wears the shared chrome", () => {
  it("finds all four cards", async () => {
    const files = await cardFiles();
    expect(files.map((file) => path.relative(APP, file))).toEqual([
      "opengraph-image.tsx",
      path.join("recap", "[token]", "opengraph-image.tsx"),
      path.join("s", "[shopSlug]", "opengraph-image.tsx"),
      path.join("s", "[shopSlug]", "trips", "[id]", "opengraph-image.tsx"),
    ]);
  });

  /**
   * **Whose card is it?** The two shop-scoped cards led with the wordmark at
   * display scale and closed with DiveDay's tagline, on links a dive shop
   * posts to its own audience — and on the departure card the tagline shared a
   * line with the shop's own "3 spots left", so the two read as one claim
   * (issue #810). `brand.md` already had the answer: the product may be the
   * actor when it acts on someone's behalf, and otherwise the shop's work
   * stays in the foreground.
   *
   * This is a text check on the source rather than on a rendered bitmap
   * because the bitmap is what nobody ever looks at — which is how the cards
   * got this way. It fails the moment somebody puts the lockup back.
   */
  it("keeps DiveDay's lockup and tagline off the cards that belong to a shop", async () => {
    for (const file of await cardFiles()) {
      const relative = path.relative(APP, file);
      const isShopCard = relative.startsWith(`s${path.sep}`);
      const source = stripComments(await readFile(file, "utf8"));
      if (isShopCard) {
        expect(source, `${relative} closes with DiveDay's tagline`).not.toMatch(/OG_TAGLINE/);
        expect(source, `${relative} should credit DiveDay at the foot`).toMatch(/ogCredit\(\)/);
        // Exactly one lockup survives on each: the unknown-slug fallback, which
        // names no shop and is therefore DiveDay's own card rather than
        // somebody's. A second one is the headline creeping back.
        expect(
          source.match(/\{OG_WORDMARK\}/g)?.length ?? 0,
          `${relative} draws the lockup outside its generic fallback`,
        ).toBeLessThanOrEqual(1);
      } else {
        // DiveDay's own cards keep both: there, DiveDay *is* the subject.
        expect(source, `${relative} is DiveDay's own card and should wear the lockup`).toMatch(
          /\{OG_WORDMARK\}/,
        );
      }
    }
  });

  it("draws none of its own — no local wordmark, card style, or bubble", async () => {
    for (const file of await cardFiles()) {
      const source = stripComments(await readFile(file, "utf8"));
      const where = path.relative(process.cwd(), file);
      expect(source, `${where} must import the shared chrome`).toMatch(/from "@\/app\/_og\/card"/);
      // A hand-drawn bubble is a fully-rounded box; a hand-drawn ground is a
      // hex literal. Either means this card can drift away from the other three.
      expect(source, `${where} draws its own bubble — use OG_WORDMARK`).not.toMatch(/borderRadius/);
      expect(source, `${where} carries a raw hex — use OG_COLORS`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
      expect(source, `${where} declares its own chrome constant`).not.toMatch(
        /\bconst (WORDMARK|CARD_STYLE)\b/,
      );
      // Unchanged obligation, and the one whose failure severs the socket
      // rather than returning an error (ADR 20260804-og-svg-rasterizer).
      expect(source, `${where} must call allowSvgRasterization()`).toMatch(
        /await allowSvgRasterization\(\)/,
      );
    }
  });
});
