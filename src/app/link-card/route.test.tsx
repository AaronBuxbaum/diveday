import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    constructor(
      public readonly body: unknown,
      public readonly options: unknown,
    ) {}
  },
}));

const mocks = vi.hoisted(() => ({ allowSvgRasterization: vi.fn() }));

vi.mock("@/lib/og-rasterizer", () => ({ allowSvgRasterization: mocks.allowSvgRasterization }));

import { LINK_CARD_SIZE, sharedLinkCardImage } from "@/lib/site-metadata";
import { GET } from "./route";

/**
 * As a metadata convention file this card exported `size` and `alt`, and Next
 * generated both the URL and the `<meta>` tags from them — the route and the
 * unfurl could not disagree. Issue #1709 moved it to a route handler to keep
 * `next/og` out of every page entry, which splits that pair: the route draws
 * the bitmap and `sharedLinkCardImage` describes it. These are the assertions
 * that hold the two halves together, because the only place a disagreement
 * shows up is a stranger's chat window.
 */
describe("the shared link card", () => {
  it("rasterizes at the size its metadata promises, and unblocks SVG first", async () => {
    const response = (await GET()) as unknown as { options: unknown };

    // ADR 20260804-og-svg-rasterizer: skipping this severs the socket
    // mid-stream rather than returning an error, so it is asserted and not
    // reviewed.
    expect(mocks.allowSvgRasterization).toHaveBeenCalledOnce();
    expect(response.options).toEqual(LINK_CARD_SIZE);
    expect({
      width: sharedLinkCardImage.width,
      height: sharedLinkCardImage.height,
    }).toEqual({ width: LINK_CARD_SIZE.width, height: LINK_CARD_SIZE.height });
  });

  it("is served at the URL the metadata sends crawlers to", () => {
    // Renaming this directory changes the route and nothing else, so the
    // `og:image` would point at a 404 that no page, screenshot or visual
    // baseline can show anybody.
    const segment = path.basename(path.dirname(fileURLToPath(import.meta.url)));
    expect(sharedLinkCardImage.url).toBe(`/${segment}`);
  });
});
