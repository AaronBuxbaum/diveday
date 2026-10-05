import { beforeEach, describe, expect, it, vi } from "vitest";
import { supersededDiveSitePhotos, uploadDiveSitePhotos } from "./dive-site-photos";

/**
 * `uploadDiveSitePhotos` reaches storage through `storeDiveSiteImage`, which
 * reads the Blob token out of the environment. Stubbing the one seam keeps
 * these tests about the form's rules — what a blank input means, what a
 * remove box means, what the six-photo cap does — rather than about uploading.
 */
const storeDiveSiteImage = vi.hoisted(() => vi.fn());
vi.mock("./index", () => ({ storeDiveSiteImage }));

/** A picked file, as the browser posts one. */
function pick(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

/** The form's own field names — the contract this module owns both halves of. */
function form(entries: Array<[string, string | File]> = []): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const existing = {
  satelliteImageUrl: "https://store/map-old.jpg",
  routeImageUrl: null,
  imageUrls: ["https://store/a.jpg", "https://store/b.jpg"],
  landmarks: [],
};

beforeEach(() => {
  storeDiveSiteImage.mockReset();
  let n = 0;
  storeDiveSiteImage.mockImplementation(async () => ({
    status: "stored",
    url: `https://store/new-${++n}.jpg`,
  }));
});

describe("uploadDiveSitePhotos", () => {
  it("keeps every stored photo when nothing was picked and nothing ticked", async () => {
    const result = await uploadDiveSitePhotos(form(), existing);
    expect(result).toEqual({ ok: true, photos: existing_asPhotos() });
    expect(storeDiveSiteImage).not.toHaveBeenCalled();
  });

  it("replaces a single photo with the file picked for it", async () => {
    const result = await uploadDiveSitePhotos(
      form([["satelliteImageFile", pick("map.jpg")]]),
      existing,
    );
    expect(result.ok && result.photos.satelliteImageUrl).toBe("https://store/new-1.jpg");
    // …and touches nothing else.
    expect(result.ok && result.photos.imageUrls).toEqual(existing.imageUrls);
  });

  it("clears a photo when its remove box is ticked", async () => {
    const result = await uploadDiveSitePhotos(form([["removeSatelliteImage", "true"]]), existing);
    expect(result.ok && result.photos.satelliteImageUrl).toBeUndefined();
  });

  // A picked file and a ticked box together is a staffer replacing a photo and
  // forgetting to untick; the file is the later, more deliberate act.
  it("lets a picked file win over a remove box ticked in the same submit", async () => {
    const result = await uploadDiveSitePhotos(
      form([
        ["removeSatelliteImage", "true"],
        ["satelliteImageFile", pick("map.jpg")],
      ]),
      existing,
    );
    expect(result.ok && result.photos.satelliteImageUrl).toBe("https://store/new-1.jpg");
  });

  it("drops the gallery photos whose own URL was ticked, and appends the new ones", async () => {
    const result = await uploadDiveSitePhotos(
      form([
        ["removeSiteImageUrls", "https://store/a.jpg"],
        ["siteImageFiles", pick("reef.jpg")],
      ]),
      existing,
    );
    expect(result.ok && result.photos.imageUrls).toEqual([
      "https://store/b.jpg",
      "https://store/new-1.jpg",
    ]);
  });

  // Refused *before* a byte is uploaded — refusing afterwards would leave
  // stored objects nothing references.
  it("refuses a gallery that would exceed six, without uploading anything", async () => {
    const result = await uploadDiveSitePhotos(
      form(Array.from({ length: 5 }, () => ["siteImageFiles", pick("reef.jpg")] as [string, File])),
      existing,
    );
    expect(result).toEqual({ ok: false, reason: "rejected" });
    expect(storeDiveSiteImage).not.toHaveBeenCalled();
  });

  it("counts removals against the cap, so a swap of six for six is fine", async () => {
    const full = {
      ...existing,
      imageUrls: Array.from({ length: 6 }, (_, i) => `https://store/${i}`),
    };
    const result = await uploadDiveSitePhotos(
      form([
        ["removeSiteImageUrls", "https://store/0"],
        ["siteImageFiles", pick("reef.jpg")],
      ]),
      full,
    );
    expect(result.ok && result.photos.imageUrls).toHaveLength(6);
  });

  // An operator gap (no Blob token) and a bad file are different problems and
  // the form says something different for each.
  it("reports an unconfigured deployment distinctly from a rejected file", async () => {
    storeDiveSiteImage.mockResolvedValueOnce({ status: "not_configured" });
    const unconfigured = await uploadDiveSitePhotos(
      form([["satelliteImageFile", pick("map.jpg")]]),
      existing,
    );
    expect(unconfigured).toEqual({ ok: false, reason: "not_configured" });

    storeDiveSiteImage.mockResolvedValueOnce({ status: "failed" });
    const rejected = await uploadDiveSitePhotos(
      form([["satelliteImageFile", pick("map.jpg")]]),
      existing,
    );
    expect(rejected).toEqual({ ok: false, reason: "rejected" });
  });

  it("starts from nothing on the create form, where there is no existing briefing", async () => {
    const result = await uploadDiveSitePhotos(form([["siteImageFiles", pick("reef.jpg")]]));
    expect(result).toEqual({
      ok: true,
      photos: {
        satelliteImageUrl: undefined,
        routeImageUrl: undefined,
        imageUrls: ["https://store/new-1.jpg"],
        landmarks: [],
      },
    });
  });

  // A file input a staffer never touched posts an empty `File`, not nothing.
  it("reads an untouched file input as no change rather than as an upload", async () => {
    const empty = new File([], "", { type: "application/octet-stream" });
    const result = await uploadDiveSitePhotos(form([["satelliteImageFile", empty]]), existing);
    expect(result.ok && result.photos.satelliteImageUrl).toBe(existing.satelliteImageUrl);
    expect(storeDiveSiteImage).not.toHaveBeenCalled();
  });
});

describe("supersededDiveSitePhotos", () => {
  it("names every blob this save left nothing pointing at", () => {
    expect(
      supersededDiveSitePhotos(existing, {
        satelliteImageUrl: "https://store/map-new.jpg",
        routeImageUrl: undefined,
        imageUrls: ["https://store/b.jpg"],
        landmarks: [],
      }),
    ).toEqual(["https://store/map-old.jpg", "https://store/a.jpg"]);
  });

  it("names nothing when the save changed no photo", () => {
    expect(supersededDiveSitePhotos(existing, existing_asPhotos())).toEqual([]);
  });

  // The one that would orphan a live photo: a gallery shot promoted to the map
  // still is the same object under a second column, not a superseded one.
  it("keeps a photo that merely moved between columns", () => {
    expect(
      supersededDiveSitePhotos(existing, {
        satelliteImageUrl: "https://store/a.jpg",
        routeImageUrl: "https://store/map-old.jpg",
        imageUrls: ["https://store/b.jpg"],
        landmarks: [],
      }),
    ).toEqual([]);
  });
});

/** `existing` in the shape a save returns — nulls become undefined. */
function existing_asPhotos() {
  return {
    satelliteImageUrl: existing.satelliteImageUrl,
    routeImageUrl: undefined,
    imageUrls: existing.imageUrls,
    landmarks: [],
  };
}

/**
 * A landmark's photo rides the same save: a file input per row, named by the
 * row's index in the posted list, and a kept photo carried in the JSON.
 */
describe("landmark photos", () => {
  const light = {
    name: "Molasses Reef Light",
    kind: "navigationMark",
    note: "",
    photoUrl: "/store/light.jpg",
  } as const;
  const stored = { ...existing, landmarks: [light] };
  const posted = (landmarks: unknown[]) =>
    ["landmarks", JSON.stringify(landmarks)] as [string, string];

  beforeEach(() => {
    let n = 0;
    // Root-relative, which `parseDiveSiteLandmarks` keeps without a storage
    // origin configured in the test environment.
    storeDiveSiteImage.mockImplementation(async () => ({
      status: "stored",
      url: `/store/landmark-${++n}.jpg`,
    }));
  });

  it("uploads the file picked for a row onto that row", async () => {
    const result = await uploadDiveSitePhotos(
      form([
        posted([
          { name: "", kind: "pointOfInterest", note: "" },
          { name: "Anchor", kind: "reefHistory", note: "" },
        ]),
        ["landmarkPhotoFile-1", pick("anchor.jpg")],
      ]),
      stored,
    );
    // The nameless first row is dropped, and the photo still lands on the
    // row it was picked for.
    expect(result.ok && result.photos.landmarks).toEqual([
      { name: "Anchor", kind: "reefHistory", note: "", photoUrl: "/store/landmark-1.jpg" },
    ]);
  });

  it("stores nothing for a row the parser will drop", async () => {
    // A nameless row, and rows past the cap: each file would be an object
    // nothing references, so none is stored.
    const rows = [
      { name: " ", kind: "pointOfInterest", note: "" },
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `Row ${i}`,
        kind: "pointOfInterest",
        note: "",
      })),
    ];
    const files = rows.map(
      (_, i) => [`landmarkPhotoFile-${i}`, pick(`${i}.jpg`)] as [string, File],
    );
    const result = await uploadDiveSitePhotos(form([posted(rows), ...files]), stored);
    expect(result.ok && result.photos.landmarks).toHaveLength(8);
    expect(storeDiveSiteImage).toHaveBeenCalledTimes(8);
  });

  it("keeps a photo the site already held", async () => {
    const result = await uploadDiveSitePhotos(form([posted([light])]), stored);
    expect(result.ok && result.photos.landmarks).toEqual([light]);
    expect(storeDiveSiteImage).not.toHaveBeenCalled();
  });

  it("refuses to keep a photo the site never held", async () => {
    const result = await uploadDiveSitePhotos(
      form([posted([{ ...light, photoUrl: "/store/someone-elses.jpg" }])]),
      stored,
    );
    expect(result.ok && result.photos.landmarks[0]).not.toHaveProperty("photoUrl");
  });

  it("names a removed landmark photo as superseded", async () => {
    const result = await uploadDiveSitePhotos(
      form([posted([{ ...light, photoUrl: undefined }])]),
      stored,
    );
    expect(result.ok && supersededDiveSitePhotos(stored, result.photos)).toEqual([
      "/store/light.jpg",
    ]);
  });
});
