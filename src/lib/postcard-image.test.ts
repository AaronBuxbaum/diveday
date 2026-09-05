import { describe, expect, it } from "vitest";
import {
  drawPostcard,
  POSTCARD_FRAME,
  type PostcardImage,
  type PostcardPalette,
} from "./postcard-image";

/**
 * **What the shared picture may contain** — issue #1081.
 *
 * The whole reason the recap exports an image rather than offering a link is
 * that one of the two URLs rendering this surface is a bearer capability that
 * can cancel a booking. So the assertion that matters is negative and it is
 * asserted here, against the drawing's actual output, rather than trusted to
 * the shape of the value object: **no text this card draws may look like a
 * URL, a recap path or a readiness path.**
 *
 * A recording stub stands in for a canvas context. jsdom has no 2D context at
 * all, and a real one would make this a test of pixels rather than of the
 * rules — what is being pinned is which strings are written and where the frame
 * ends, both of which a recorder answers exactly.
 */

type Call = { text: string; x: number; y: number };

function recorder() {
  const calls: { fills: Call[]; rects: number[][]; dashes: number[][]; lines: number[][] } = {
    fills: [],
    rects: [],
    dashes: [],
    lines: [],
  };
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    textAlign: "left",
    textBaseline: "alphabetic",
    fillText: (text: string, x: number, y: number) => calls.fills.push({ text, x, y }),
    fillRect: (...rect: number[]) => calls.rects.push(rect),
    drawImage: (...rest: unknown[]) => calls.lines.push(rest.slice(1) as number[]),
    // A measurement that scales with the font actually set, so the wrap tests
    // exercise the real relationship between a 38px fact and a 936px measure.
    // Roughly half an em per character is close enough to a proportional face,
    // and — unlike a real canvas — it is the same on every machine.
    measureText: (text: string) => ({
      width: text.length * 0.52 * (Number(/(\d+)px/.exec(ctx.font)?.[1]) || 16),
    }),
    setLineDash: (dash: number[]) => calls.dashes.push(dash),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const PALETTE: PostcardPalette = {
  surface: "rgb(255, 253, 250)",
  band: "rgb(226, 240, 238)",
  ink: "rgb(16, 38, 44)",
  muted: "rgb(92, 108, 112)",
  accent: "rgb(0, 110, 130)",
  rule: "rgb(224, 220, 214)",
};

function postcard(overrides: Partial<PostcardImage> = {}): PostcardImage {
  return {
    shopName: "Blue Mantis Divers",
    heading: "Dive log entry",
    diveDayLine: "Dive day № 3",
    facts: [
      { label: "Diver", value: "Yara Halabi" },
      { label: "Date", value: "Sat, Aug 29" },
      { label: "Sites", value: "French Reef" },
    ],
    privateLine: null,
    recordedBy: "Recorded by Blue Mantis Divers",
    ...overrides,
  };
}

describe("the exported postcard", () => {
  it("fills exactly the 4:5 frame whatever it is handed", () => {
    for (const card of [postcard(), postcard({ facts: [], privateLine: "a".repeat(400) })]) {
      const { ctx, calls } = recorder();
      drawPostcard(ctx, card, PALETTE, null);
      expect(calls.rects[0]).toEqual([0, 0, POSTCARD_FRAME.width, POSTCARD_FRAME.height]);
      expect(POSTCARD_FRAME.width / POSTCARD_FRAME.height).toBeCloseTo(0.8);
    }
  });

  /**
   * The negative assertion this file exists for. A bearer URL in a picture
   * headed for a group chat is the failure mode the whole export replaces a
   * share button to avoid.
   */
  it("draws no URL, no recap path and no readiness path", () => {
    const { ctx, calls } = recorder();
    drawPostcard(ctx, postcard({ privateLine: "The eagle ray on the second tank" }), PALETTE, null);
    expect(calls.fills.length).toBeGreaterThan(0);
    for (const { text } of calls.fills) {
      expect(text).not.toMatch(/https?:|\/recap\/|\/ready\/|www\./i);
    }
  });

  it("draws only text the value object gave it", () => {
    const { ctx, calls } = recorder();
    const card = postcard({ privateLine: "Best day of the trip" });
    drawPostcard(ctx, card, PALETTE, null);
    const allowed = [
      card.shopName,
      card.heading,
      card.diveDayLine,
      card.recordedBy,
      ...card.facts.flatMap((fact) => [fact.label, fact.value]),
      card.privateLine ?? "",
    ];
    for (const { text } of calls.fills) {
      // Every drawn run is either a whole field or a wrapped fragment of the
      // one field that wraps — nothing is composed here out of anything else.
      expect(allowed.some((value) => value.includes(text))).toBe(true);
    }
  });

  it("draws neither the dashed rule nor a blank row when the diver typed nothing", () => {
    const { ctx, calls } = recorder();
    drawPostcard(ctx, postcard({ privateLine: null }), PALETTE, null);
    expect(calls.dashes).toHaveLength(0);
    expect(calls.fills.some(({ text }) => text.trim() === "")).toBe(false);
  });

  it("wraps a long private line instead of running it off the frame", () => {
    const { ctx, calls } = recorder();
    const line =
      "The eagle ray came past twice on the second tank and the whole boat went quiet for it, " +
      "and then again on the safety stop while everybody was hanging on the line watching it go";
    drawPostcard(ctx, postcard({ privateLine: line }), PALETTE, null);
    // The dashed rule is drawn once, and the line arrives as more than one run.
    expect(calls.dashes.filter((dash) => dash.length > 0)).toHaveLength(1);
    const fragments = calls.fills.filter(({ text }) => line.includes(text) && text !== line);
    expect(fragments.length).toBeGreaterThan(1);
    // Reassembled, it is exactly what the diver typed — nothing was cut.
    expect(fragments.map(({ text }) => text).join(" ")).toBe(line);
  });

  /**
   * Found by looking at a real export: the demo shop's conditions line is
   * "Water temp: 27°C · Visibility: 18 m · Surface: Light east breeze · gentle
   * chop", and drawn on one line it walked off the right edge of a picture
   * somebody was about to share. Canvas clips nothing and reports nothing, so
   * only a person looking at the PNG — or this — can catch it.
   */
  it("wraps a fact value too long for the measure instead of running it off the edge", () => {
    const { ctx, calls } = recorder();
    const conditions =
      "Water temp: 27°C · Visibility: 18 m · Surface: Light east breeze · gentle chop";
    drawPostcard(
      ctx,
      postcard({ facts: [{ label: "Conditions on the day", value: conditions }] }),
      PALETTE,
      null,
    );
    const fragments = calls.fills.filter(
      ({ text }) => conditions.includes(text) && text !== conditions,
    );
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.map(({ text }) => text).join(" ")).toBe(conditions);
    // A taller row, not an overlapping one: every fragment sits below the last.
    const ys = fragments.map(({ y }) => y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(ys.length);
  });

  it("still draws a complete card when the site drawing could not be borrowed", () => {
    const withMark = recorder();
    const withoutMark = recorder();
    const card = postcard();
    drawPostcard(withMark.ctx, card, PALETTE, {} as CanvasImageSource);
    drawPostcard(withoutMark.ctx, card, PALETTE, null);
    // Same words either way; the drawing is decoration beside facts that say
    // everything, exactly as it is on the page.
    expect(withoutMark.calls.fills.map(({ text }) => text)).toEqual(
      withMark.calls.fills.map(({ text }) => text),
    );
    expect(withMark.calls.lines).toHaveLength(1);
    expect(withoutMark.calls.lines).toHaveLength(0);
  });
});
