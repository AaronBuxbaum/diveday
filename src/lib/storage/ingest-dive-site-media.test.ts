import { describe, expect, it, vi } from "vitest";

vi.mock("./ingest-url", () => ({
  ingestImageUrl: vi.fn(async (url: string) => {
    if (url.includes("bad")) return { status: "blocked" };
    if (url.includes("unconfigured")) return { status: "not_configured" };
    return {
      status: "stored",
      url: `https://store.public.blob.vercel-storage.com/dive-sites/x-${url}`,
    };
  }),
}));

const { ingestDiveSiteMedia } = await import("./ingest-dive-site-media");

describe("ingestDiveSiteMedia (CR-020)", () => {
  it("resolves a bundled Commons URL to its local path without fetching", async () => {
    const commonsUrl =
      "https://commons.wikimedia.org/wiki/Special:FilePath/AtlanticGoliathGrouper.jpg";
    const result = await ingestDiveSiteMedia({ satelliteImageUrl: commonsUrl, imageUrls: [] });
    expect(result).toEqual({
      ok: true,
      satelliteImageUrl: "/dive-sites/AtlanticGoliathGrouper.jpg",
      routeImageUrl: undefined,
      imageUrls: [],
    });
  });

  it("ingests a genuine third-party URL to a first-party stored URL", async () => {
    const result = await ingestDiveSiteMedia({
      satelliteImageUrl: "https://cdn.example/sat.jpg",
      imageUrls: ["https://cdn.example/gallery1.jpg", "https://cdn.example/gallery2.jpg"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.satelliteImageUrl).toMatch(/^https:\/\/store\.public\.blob/);
    expect(result.imageUrls).toHaveLength(2);
  });

  it("passes undefined through for an empty field", async () => {
    const result = await ingestDiveSiteMedia({ imageUrls: [] });
    expect(result).toEqual({
      ok: true,
      satelliteImageUrl: undefined,
      routeImageUrl: undefined,
      imageUrls: [],
    });
  });

  it("fails the whole save when any single URL can't be ingested, never falling back to the raw URL", async () => {
    const result = await ingestDiveSiteMedia({
      imageUrls: ["https://cdn.example/good.jpg", "https://cdn.example/bad.jpg"],
    });
    expect(result).toEqual({ ok: false, reason: "rejected" });
  });

  it("surfaces not_configured distinctly from a rejected URL", async () => {
    const result = await ingestDiveSiteMedia({
      satelliteImageUrl: "https://cdn.example/unconfigured.jpg",
      imageUrls: [],
    });
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("reports not_configured even when another URL was also rejected", async () => {
    const result = await ingestDiveSiteMedia({
      satelliteImageUrl: "https://cdn.example/unconfigured.jpg",
      routeImageUrl: "https://cdn.example/bad.jpg",
      imageUrls: [],
    });
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });
});
