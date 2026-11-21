import { beforeEach, describe, expect, it, vi } from "vitest";
import { addedDiveSitePhotos, uploadDiveSitePhotos } from "./dive-site-photos";

const storeDiveSiteImage = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/storage/index", () => ({ storeDiveSiteImage }));

function pick(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

describe("a batch where one photo is refused", () => {
  beforeEach(() => storeDiveSiteImage.mockReset());

  it("names the photos it had already stored, so the caller deletes them", async () => {
    storeDiveSiteImage
      .mockResolvedValueOnce({ status: "stored", url: "https://store/map.jpg" })
      .mockResolvedValueOnce({ status: "failed" });
    const data = new FormData();
    data.set("satelliteImageFile", pick("map.jpg"));
    data.set("routeImageFile", pick("route.jpg"));
    const result = await uploadDiveSitePhotos(data);
    expect(result).toEqual({ ok: false, reason: "rejected", stored: ["https://store/map.jpg"] });
  });
});

describe("addedDiveSitePhotos", () => {
  const before = {
    satelliteImageUrl: "https://store/map-old.jpg",
    routeImageUrl: null,
    imageUrls: ["https://store/a.jpg"],
    landmarks: [
      { name: "Wall", kind: "pointOfInterest" as const, note: "", photoUrl: "/media/wall-old.jpg" },
    ],
  };

  it("lists only what the save stored, not what the site already held", () => {
    const after = {
      satelliteImageUrl: "https://store/map-new.jpg",
      routeImageUrl: undefined,
      imageUrls: ["https://store/a.jpg", "https://store/b.jpg"],
      landmarks: [
        {
          name: "Wall",
          kind: "pointOfInterest" as const,
          note: "",
          photoUrl: "/media/wall-old.jpg",
        },
        { name: "Cave", kind: "pointOfInterest" as const, note: "", photoUrl: "/media/cave.jpg" },
      ],
    };
    expect(addedDiveSitePhotos(before, after)).toEqual([
      "https://store/map-new.jpg",
      "https://store/b.jpg",
      "/media/cave.jpg",
    ]);
  });

  it("lists every photo on a create, where nothing was held", () => {
    const after = { imageUrls: ["https://store/a.jpg"], landmarks: [] };
    expect(addedDiveSitePhotos(undefined, after)).toEqual(["https://store/a.jpg"]);
  });
});
