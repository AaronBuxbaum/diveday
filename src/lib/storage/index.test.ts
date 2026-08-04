import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deleteStoredImage,
  deleteStoredImageTracked,
  imageStorageProviderFromEnvironment,
  isManagedBlobUrl,
  MAX_COURSE_IMAGE_BYTES,
  storeCourseImage,
  storeImportWaiverDocument,
} from "./index";
import { MAX_IMAGE_BYTES } from "./limits";

let realJpeg: Buffer;

beforeAll(async () => {
  realJpeg = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 30, g: 90, b: 150 } },
  })
    .jpeg()
    .toBuffer();
});

function upload(overrides: Partial<Parameters<typeof storeCourseImage>[0]> = {}) {
  return {
    filename: "reef course.jpg",
    contentType: "image/jpeg",
    bytes: realJpeg,
    ...overrides,
  };
}

describe("image storage seam (the pipeline every upload wrapper shares)", () => {
  it("returns not_configured when no storage token is set", async () => {
    const provider = imageStorageProviderFromEnvironment({}, vi.fn());
    expect(await storeCourseImage(upload(), provider)).toEqual({ status: "not_configured" });
  });

  it("rejects a non-image before touching the provider", async () => {
    const provider = { upload: vi.fn() };
    expect(await storeCourseImage(upload({ contentType: "application/pdf" }), provider)).toEqual({
      status: "failed",
    });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized file before touching the provider", async () => {
    const provider = { upload: vi.fn() };
    expect(await storeCourseImage(upload({ bytes: new ArrayBuffer(0) }), provider)).toEqual({
      status: "failed",
    });
    expect(
      await storeCourseImage(
        upload({ bytes: new ArrayBuffer(MAX_COURSE_IMAGE_BYTES + 1) }),
        provider,
      ),
    ).toEqual({ status: "failed" });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("rejects a disguised file that claims an allowed content-type but isn't really an image (CR-012)", async () => {
    const provider = { upload: vi.fn() };
    const disguised = Buffer.from("not actually a jpeg".repeat(100));
    expect(await storeCourseImage(upload({ bytes: disguised }), provider)).toEqual({
      status: "failed",
    });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("uploads to Vercel Blob and returns the durable URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://blob.example/courses/abc-reef-course.jpg" }),
    });
    const provider = imageStorageProviderFromEnvironment(
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    const result = await storeCourseImage(upload(), provider);
    expect(result).toEqual({
      status: "stored",
      url: "https://blob.example/courses/abc-reef-course.jpg",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("https://blob.vercel-storage.com/courses/");
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
      json: async () => ({ url: "https://blob.example/courses/abc-reef-course.jpg" }),
    });
    const provider = imageStorageProviderFromEnvironment(
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    await storeCourseImage(
      upload({ filename: "reef course.png", contentType: "image/png", bytes: png }),
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
    expect(await storeCourseImage(upload(), provider)).toEqual({ status: "failed" });
  });

  it("keys every upload with a CSPRNG suffix, never a colliding or guessable one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://blob.example/courses/x-reef-course.jpg" }),
    });
    const provider = imageStorageProviderFromEnvironment(
      { BLOB_READ_WRITE_TOKEN: "test-token" },
      fetchImpl as unknown as typeof fetch,
    );
    const pathnames: string[] = [];
    for (let i = 0; i < 20; i++) {
      await storeCourseImage(upload(), provider);
      const [url] = fetchImpl.mock.calls[i];
      const pathname = new URL(String(url)).pathname;
      // "/courses/<22-char base64url suffix>-reef-course.jpg"
      const suffix = pathname.split("/")[2]?.split("-reef-course.jpg")[0];
      expect(suffix).toMatch(/^[A-Za-z0-9_-]{22}$/);
      pathnames.push(pathname);
    }
    expect(new Set(pathnames).size).toBe(pathnames.length);
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

describe("import document storage — images and PDFs", () => {
  const fakePdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

  it("stores a PDF as-is, bypassing the image pipeline, with an application/pdf type and .pdf name", async () => {
    const provider = {
      upload: vi.fn().mockResolvedValue({ status: "stored", url: "https://blob.example/x.pdf" }),
    };
    const result = await storeImportWaiverDocument(
      { filename: "waiver.pdf", contentType: "application/pdf", bytes: fakePdf },
      provider,
    );
    expect(result).toEqual({ status: "stored", url: "https://blob.example/x.pdf" });
    expect(provider.upload).toHaveBeenCalledTimes(1);
    const arg = provider.upload.mock.calls[0][0];
    expect(arg.contentType).toBe("application/pdf");
    expect(arg.filename).toMatch(/\.pdf$/);
    // The raw PDF bytes are stored unchanged — never re-encoded to JPEG.
    expect(arg.bytes).toBe(fakePdf);
    expect(arg.keyPrefix).toBe("import-waivers");
  });

  it("routes on magic bytes, not the claimed type: a mislabeled non-PDF is rejected", async () => {
    const provider = { upload: vi.fn() };
    const notReallyPdf = Buffer.from("this is not a pdf".repeat(20));
    expect(
      await storeImportWaiverDocument(
        { filename: "waiver.pdf", contentType: "application/pdf", bytes: notReallyPdf },
        provider,
      ),
    ).toEqual({ status: "failed" });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("rejects an oversized PDF before touching the provider", async () => {
    const provider = { upload: vi.fn() };
    const huge = Buffer.concat([fakePdf, Buffer.alloc(MAX_IMAGE_BYTES + 1)]);
    expect(
      await storeImportWaiverDocument(
        { filename: "big.pdf", contentType: "application/pdf", bytes: huge },
        provider,
      ),
    ).toEqual({ status: "failed" });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it("still takes the image path for an image document (re-encoded to JPEG)", async () => {
    const provider = {
      upload: vi.fn().mockResolvedValue({ status: "stored", url: "https://blob.example/x.jpg" }),
    };
    const result = await storeImportWaiverDocument(
      { filename: "scan.jpg", contentType: "image/jpeg", bytes: realJpeg },
      provider,
    );
    expect(result).toEqual({ status: "stored", url: "https://blob.example/x.jpg" });
    const arg = provider.upload.mock.calls[0][0];
    expect(arg.contentType).toBe("image/jpeg");
    expect(arg.filename).toMatch(/\.jpg$/);
  });
});
