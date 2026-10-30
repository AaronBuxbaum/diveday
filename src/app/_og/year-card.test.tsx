import { ImageResponse } from "next/og";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/brand";
import type { ShopYearSummary } from "@/lib/shop-year";
import { yearCardPalette } from "@/lib/year-card";
import { YEAR_CARD_SIZE, YearCard } from "./year-card";

const year = {
  strip: [
    { day: null, fill: 0 },
    { day: "2026-01-01", fill: 1 },
    { day: "2026-01-02", fill: 2 },
    { day: "2026-01-03", fill: 3 },
  ],
} as unknown as ShopYearSummary;

const copy = {
  shopName: "Bright Water Dive Co.",
  range: "2026 · to Aug 27",
  sentence: "A bright year on the water.",
  facts: [
    { key: "divers", value: "2,907", label: "divers" },
    { key: "boats", value: "262", label: "boats out" },
    { key: "sites", value: "48", label: "reefs and wrecks" },
  ],
};

describe("YearCard image rendering", () => {
  it("rasterizes a light-brand card with readable text", async () => {
    const response = new ImageResponse(
      <YearCard year={year} copy={copy} brandColor="#fdf1b3" />,
      YEAR_CARD_SIZE,
    );
    const palette = yearCardPalette("#fdf1b3");
    const png = Buffer.from(await response.arrayBuffer());
    const { data, info } = await sharp(png)
      .extract({ left: 1180, top: 300, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sample = `#${[...data].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

    expect(response.headers.get("content-type")).toContain("image/png");
    expect(await sharp(png).metadata()).toMatchObject({
      width: YEAR_CARD_SIZE.width,
      height: YEAR_CARD_SIZE.height,
      format: "png",
    });
    expect(info.channels).toBe(3);
    expect(
      contrastRatio(palette.ink, sample),
      `${palette.ink} on rendered pixel ${sample}`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});
