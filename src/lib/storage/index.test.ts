import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deleteStoredImage,
  deleteStoredImageTracked,
  imageStorageProviderFromEnvironment,
  isManagedBlobUrl,
  MAX_CARD_IMAGE_BYTES,
  MAX_COURSE_IMAGE_BYTES,
  storeCardImage,
  storeCourseImage,
} from "./index";

let realJpeg: Buffer;

beforeAll(async () => {
  realJpeg = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 30, g: 90, b: 150 } },
  })
    .jpeg()
    .toBuffer();
});

function upload(overrides: Partial<Parameters<typeof storeCardImage>[0]> = {}) {
  return {
    keyPrefix: "cards",
    filename: "padi ow.jpg",
    contentType: "image/jpeg",
    bytes: realJpeg,
    ...overrides,
  };
}

describe("card image storage seam", () => {
  it("returns not_configured when no storage token is set", async () => {
    const provider = imageStorageProviderFromEnvironment({}, vi.fn());
    expect(await storeCardImage(upload(), provider)).toEqual({ status: "not_configured" });
  });

  it("rejects a non-image before touching the provider", async () => {
    const provider = { upload: vi.fn() };
    expect(await storeCardImage(upload({ contentType: "application/pdf" }), provider)).toEqual({
      status: "failed",
    });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized file before touching the provider", async () => {
    const provider = { upload: vi.fn() };
    expect(await storeCardImage(upload({ bytes: new ArrayBuffer(0) }), provider)).toEqual({
      status: "failed",
    });
    expect(
      await storeCardImage(upload({ bytes: new ArrayBuffer(MAX_CARD_IMAGE_BYTES + 1) }), provider),
    ).toEqual({ status: "failed" });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("rejects a disguised file that claims an allowed content-type but isn't really an image (CR-012)", async () => {
    const provider = { upload: vi.fn() };
    const disguised = Buffer.from("not actually a jpeg".repeat(100));
    expect(await storeCardImage(upload({ bytes: disguised }), provider)).toEqual({
      status: "failed",
    });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("uploads to Vercel Blob and returns the durable URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://blob.example/cards/abc-padi-ow.jpg" }),
    });
    const provider = imageStorageProviderFromEnvironment(
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    const result = await storeCardImage(upload(), provider);
    expect(result).toEqual({ status: "stored", url: "https://blob.example/cards/abc-padi-ow.jpg" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("https://blob.vercel-storage.com/cards/");
    expect(String(url)).toContain(".jpg");
    expect(init.headers.authorization).toBe("Bearer test-token");
    // The re-encoded output content-type (CR-012), not whatever the caller claimed.
    expect(init.headers["x-content-type"]).toBe("image/jpeg");
  });

  it("re-encodes even a PNG upload to JPEG before it reaches the provider (CR-012)", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://blob.example/cards/abc-padi-ow.jpg" }),
    });
    const provider = imageStorageProviderFromEnvironment(
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    await storeCardImage(
      upload({ filename: "card.png", contentType: "image/png", bytes: png }),
      provider,
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["x-content-type"]).toBe("image/jpeg");
  });

  it("fails closed when the provider responds with an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const provider = imageStorageProviderFromEnvironment(
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await storeCardImage(upload(), provider)).toEqual({ status: "failed" });
  });
});

describe("course image storage", () => {
  function courseUpload(overrides: Partial<Parameters<typeof storeCourseImage>[0]> = {}) {
    return {
      filename: "open water students.jpg",
      contentType: "image/jpeg",
      bytes: realJpeg,
      ...overrides,
    };
  }

  it("keeps course media in its own key namespace, away from card evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://blob.example/courses/abc-open-water-students.jpg" }),
    });
    const provider = imageStorageProviderFromEnvironment(
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await storeCourseImage(courseUpload(), provider)).toEqual({
      status: "stored",
      url: "https://blob.example/courses/abc-open-water-students.jpg",
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      "https://blob.vercel-storage.com/courses/",
    );
  });

  it("applies the same validation a card gets", async () => {
    const provider = { upload: vi.fn() };
    expect(await storeCourseImage(courseUpload({ contentType: "text/html" }), provider)).toEqual({
      status: "failed",
    });
    expect(
      await storeCourseImage(
        courseUpload({ bytes: new ArrayBuffer(MAX_COURSE_IMAGE_BYTES + 1) }),
        provider,
      ),
    ).toEqual({ status: "failed" });
    expect(provider.upload).not.toHaveBeenCalled();
  });
});

describe("deleteStoredImage (best-effort cleanup)", () => {
  it("no-ops without a token", async () => {
    const fetchImpl = vi.fn();
    await deleteStoredImage("https://blob/x.jpg", {}, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the blob URL to the delete endpoint when a token is set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    await deleteStoredImage(
      "https://blob/x.jpg",
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/delete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ urls: ["https://blob/x.jpg"] });
  });

  it("swallows a provider error — cleanup never throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    await expect(
      deleteStoredImage(
        "https://blob/x.jpg",
        { BLOB_READ_WRITE_TOKEN: "test-token" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("deleteStoredImageTracked (CR-012)", () => {
  it("reports success without a token — nothing was ever stored to leave behind", async () => {
    const fetchImpl = vi.fn();
    expect(
      await deleteStoredImageTracked(
        "https://blob/x.jpg",
        {},
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports success when the provider confirms the delete", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    expect(
      await deleteStoredImageTracked(
        "https://blob/x.jpg",
        { BLOB_READ_WRITE_TOKEN: "test-token" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual({ ok: true });
  });

  it("reports failure with a reason when the provider responds with an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await deleteStoredImageTracked(
      "https://blob/x.jpg",
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("500");
  });

  it("reports failure with a reason on a network error, instead of throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network unreachable"));
    const result = await deleteStoredImageTracked(
      "https://blob/x.jpg",
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("network unreachable");
  });
});

describe("isManagedBlobUrl (CR-012 review finding)", () => {
  it("recognizes a genuine Vercel Blob public object URL", () => {
    expect(isManagedBlobUrl("https://abc123.public.blob.vercel-storage.com/courses/x.jpg")).toBe(
      true,
    );
  });

  it("rejects a bundled template asset (root-relative, never left this app)", () => {
    expect(isManagedBlobUrl("/dive-sites/reef.jpg")).toBe(false);
  });

  it("rejects a legacy pasted external URL — the provider never stored it", () => {
    expect(isManagedBlobUrl("https://example.com/photo.jpg")).toBe(false);
  });

  it("rejects the Blob API host itself — that's for PUT/delete requests, not object URLs", () => {
    expect(isManagedBlobUrl("https://blob.vercel-storage.com/courses/x.jpg")).toBe(false);
  });

  it("fails closed on an unparseable URL instead of throwing", () => {
    expect(isManagedBlobUrl("not a url")).toBe(false);
  });
});
