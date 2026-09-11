import { describe, expect, it, vi } from "vitest";
import { capturePhoto, MARINE_LIFE_TILE_WIDTHS, tileWidthFor } from "./marine-life-tiles";

/**
 * The band, and the harness boundary.
 *
 * What is being pinned is not "returns 171" but the reason 171 is allowed: the
 * served file's width has to sit strictly inside `(box/2, 2*box)` or Chromium
 * has a legal half-scale decode and can choose between two of them, which is
 * the flip #1597 measured and #1585 kept arriving with.
 */
describe("marine-life capture tiles", () => {
  describe("tileWidthFor", () => {
    it("serves each rendered box the committed width inside its band", () => {
      // The four boxes the app renders a catalog species at, plus the catalog
      // preview's measured upper bound.
      expect(tileWidthFor(48)).toBe(48); // field guide, recap — 1.00x
      expect(tileWidthFor(80)).toBe(96); // species picker — 1.20x
      expect(tileWidthFor(171)).toBe(171); // trip pitch, catalog preview — 1.00x
      expect(tileWidthFor(173)).toBe(171); // the same preview cell at its widest — 0.99x
    });

    /**
     * The defect this pair form exists for (PR #1663). The trip pitch renders a
     * 413px cell inside an embed frame and a 171px one on the ordinary page, and
     * passing only the widest put a 171px file into the 413 cell — a 2.4x
     * enlargement that softened three photographs on `booking-confirmed-embed`
     * while every guard passed, because the band was checked against the number
     * the caller declared rather than the boxes it actually renders.
     */
    it("takes a width inside the band of every box a surface renders", () => {
      expect(tileWidthFor([109, 171])).toBe(171);
      expect(tileWidthFor([117, 413])).toBe(224);
      expect(tileWidthFor([413, 117])).toBe(224);
      expect(tileWidthFor([48])).toBe(tileWidthFor(48));
    });

    it("refuses a pair whose bands do not overlap", () => {
      expect(() => tileWidthFor([48, 413])).toThrow(/share no committed width inside/);
      expect(() => tileWidthFor([])).toThrow(/at least one box size/);
      expect(() => tileWidthFor([171, 0])).toThrow(/not a rendered box size/);
    });

    it("keeps every answer strictly inside (box/2, 2*box)", () => {
      for (const box of [48, 80, 109, 171, 173]) {
        const width = tileWidthFor(box);
        expect(width).toBeGreaterThan(box / 2);
        expect(width).toBeLessThan(box * 2);
      }
    });

    /**
     * The failure path, and the whole reason this is a function rather than a
     * lookup: a surface that starts rendering these at some other size has
     * silently reintroduced the decode choice, and it has to say so at the
     * first render instead of turning up as an unexplained visual diff.
     *
     * 500 rather than 300 or 400: at 300 the band is (150, 600) and 171 is
     * inside it; at 400 it is (200, 800) and 224 is. 500 is the first size past
     * 2x224 where nothing committed reaches, and 16 is the failure from
     * the other side — 48 is three times that box.
     */
    it("refuses a box no committed width can serve, and names the fix", () => {
      expect(() => tileWidthFor(500)).toThrow(/share no committed width inside/);
      expect(() => tileWidthFor(500)).toThrow(/--tiles-only/);
      expect(() => tileWidthFor(16)).toThrow(/share no committed width inside/);
      expect(() => tileWidthFor(0)).toThrow(/not a rendered box size/);
      expect(() => tileWidthFor(Number.NaN)).toThrow(/not a rendered box size/);
    });

    it("answers only with widths that exist on disk", () => {
      for (const box of [48, 80, 109, 171, 173]) {
        expect(MARINE_LIFE_TILE_WIDTHS).toContain(tileWidthFor(box));
      }
    });
  });

  describe("capturePhoto", () => {
    it("changes nothing outside an e2e capture", () => {
      // The production arm, and the one that matters most: a real deployment
      // renders the full-size source through the optimizer exactly as before.
      expect(capturePhoto("/marine-life/southern-stingray.jpg", 171)).toBe(
        "/marine-life/southern-stingray.jpg",
      );
    });

    it("serves the box-sized variant under the capture flag", () => {
      vi.stubEnv("DIVEDAY_E2E", "1");
      expect(capturePhoto("/marine-life/southern-stingray.jpg", 171)).toBe(
        "/marine-life/tiles/171/southern-stingray.jpg",
      );
      expect(capturePhoto("/marine-life/southern-stingray.jpg", 48)).toBe(
        "/marine-life/tiles/48/southern-stingray.jpg",
      );
    });

    it("leaves every other photo alone, flag or no flag", () => {
      vi.stubEnv("DIVEDAY_E2E", "1");
      // A dive-site cover, a blob-store object, and a variant that has already
      // been through here once — a call site wrapped twice is a no-op, not a
      // 404 into `/tiles/171/tiles`.
      for (const url of [
        "/dive-sites/molasses-reef.jpg",
        "https://media.example.com/shops/1/cover.jpg",
        "/marine-life/tiles/171/southern-stingray.jpg",
        "/marine-life/../../etc/passwd",
        "/marine-life/southern-stingray.png",
      ]) {
        expect(capturePhoto(url, 171)).toBe(url);
      }
    });

    /**
     * The refusal has to survive the flag: a capture is exactly where a wrong
     * box size must be loud, since it is the run whose whole job is noticing
     * that a photograph moved.
     */
    it("still refuses an unservable box under the flag", () => {
      vi.stubEnv("DIVEDAY_E2E", "1");
      expect(() => capturePhoto("/marine-life/southern-stingray.jpg", 500)).toThrow(
        /no committed width inside/,
      );
    });
  });
});
