import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deleteS3Image,
  deleteStoredImage,
  deleteStoredImageTracked,
  imageStorageProviderFromEnvironment,
  isManagedStorageUrl,
  MAX_COURSE_IMAGE_BYTES,
  storeCourseImage,
  storeImportReceiptDocument,
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

const mockS3Env = {
  MEDIA_BUCKET_NAME: "diveday-media",
  MEDIA_AWS_REGION: "us-east-1",
  MEDIA_AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  MEDIA_AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("image storage seam (the pipeline every upload wrapper shares)", () => {
  it("returns not_configured when no storage credentials are set", async () => {
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

  it("uploads to AWS S3 and returns the durable URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const provider = imageStorageProviderFromEnvironment(
      mockS3Env,
      fetchImpl as unknown as typeof fetch,
    );
    const result = await storeCourseImage(upload(), provider);
    expect(result.status).toBe("stored");
    if (result.status === "stored") {
      expect(result.url).toContain("https://diveday-media.s3.us-east-1.amazonaws.com/courses/");
      expect(result.url).toContain(".jpg");
    }
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("https://diveday-media.s3.us-east-1.amazonaws.com/courses/");
    expect(init.method).toBe("PUT");
    expect(init.headers.authorization).toContain("AWS4-HMAC-SHA256");
    expect(init.headers["content-type"]).toBe("image/jpeg");
  });

  it("re-encodes even a PNG upload to JPEG before it reaches the provider (CR-012)", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const provider = imageStorageProviderFromEnvironment(
      mockS3Env,
      fetchImpl as unknown as typeof fetch,
    );
    await storeCourseImage(
      upload({ filename: "reef course.png", contentType: "image/png", bytes: png }),
      provider,
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["content-type"]).toBe("image/jpeg");
  });

  it("fails closed when the provider responds with an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const provider = imageStorageProviderFromEnvironment(
      mockS3Env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(await storeCourseImage(upload(), provider)).toEqual({ status: "failed" });
  });

  it("keys every upload with a CSPRNG suffix, never a colliding or guessable one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const provider = imageStorageProviderFromEnvironment(
      mockS3Env,
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
  it("no-ops without credentials", async () => {
    const fetchImpl = vi.fn();
    await deleteStoredImage(
      "https://diveday-media.s3.amazonaws.com/x.jpg",
      {},
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("issues SigV4 DELETE request when credentials are set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    await deleteStoredImage(
      "https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg",
      mockS3Env,
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg");
    expect(init.method).toBe("DELETE");
    expect(init.headers.authorization).toContain("AWS4-HMAC-SHA256");
  });

  it("swallows a provider error — cleanup never throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    await expect(
      deleteStoredImage(
        "https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg",
        mockS3Env,
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("deleteStoredImageTracked", () => {
  it("reports success without credentials — nothing was ever stored to leave behind", async () => {
    const fetchImpl = vi.fn();
    expect(
      await deleteStoredImageTracked(
        "https://diveday-media.s3.amazonaws.com/x.jpg",
        {},
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports success when the provider confirms the delete (204)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    expect(
      await deleteStoredImageTracked(
        "https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg",
        mockS3Env,
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual({ ok: true });
  });

  it("reports failure with a reason when the provider responds with an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await deleteStoredImageTracked(
      "https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg",
      mockS3Env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("500");
  });

  it("reports failure with a reason on a network error, instead of throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network unreachable"));
    const result = await deleteStoredImageTracked(
      "https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg",
      mockS3Env,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("network unreachable");
  });
});

describe("isManagedStorageUrl", () => {
  it("recognizes the configured bucket's own endpoints", () => {
    expect(
      isManagedStorageUrl(
        "https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg",
        mockS3Env,
      ),
    ).toBe(true);
    expect(
      isManagedStorageUrl("https://diveday-media.s3.amazonaws.com/courses/x.jpg", mockS3Env),
    ).toBe(true);
  });

  it("recognizes the configured public base, so a CDN domain works once there is one", () => {
    const env = { ...mockS3Env, MEDIA_PUBLIC_URL_BASE: "https://media.diveday.test" };
    expect(isManagedStorageUrl("https://media.diveday.test/courses/x.jpg", env)).toBe(true);
  });

  /**
   * The whole point of the predicate. It used to match `.s3.amazonaws.com` and
   * `.cloudfront.net` by suffix, which is every bucket and every distribution
   * on the internet — and this predicate is the ingest allowlist, the export
   * fetch's SSRF guard, and the gate on queueing a delete.
   */
  it("rejects another account's S3 bucket and any CloudFront distribution", () => {
    expect(
      isManagedStorageUrl("https://attacker-bucket.s3.us-east-1.amazonaws.com/x.jpg", mockS3Env),
    ).toBe(false);
    expect(isManagedStorageUrl("https://attacker.s3.amazonaws.com/x.jpg", mockS3Env)).toBe(false);
    expect(isManagedStorageUrl("https://d1234.cloudfront.net/courses/x.jpg", mockS3Env)).toBe(
      false,
    );
  });

  it("rejects a bundled template asset (root-relative, never left this app)", () => {
    expect(isManagedStorageUrl("/dive-sites/reef.jpg", mockS3Env)).toBe(false);
  });

  it("rejects an external URL — the provider never stored it", () => {
    expect(isManagedStorageUrl("https://example.com/photo.jpg", mockS3Env)).toBe(false);
  });

  it("rejects plain http on our own host", () => {
    expect(
      isManagedStorageUrl(
        "http://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg",
        mockS3Env,
      ),
    ).toBe(false);
  });

  it("fails closed on an unparseable URL instead of throwing", () => {
    expect(isManagedStorageUrl("not a url", mockS3Env)).toBe(false);
  });

  it("fails closed when no media storage is configured", () => {
    expect(
      isManagedStorageUrl("https://diveday-media.s3.us-east-1.amazonaws.com/courses/x.jpg", {}),
    ).toBe(false);
  });
});

describe("deleteS3Image host binding", () => {
  const config = {
    bucket: "diveday-media",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  };

  it("deletes an object addressed by our own bucket endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const result = await deleteS3Image(
      "https://diveday-media.s3.us-east-1.amazonaws.com/courses/abc-photo.jpg",
      config,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /**
   * Keys are namespaced by content type, never by shop, and this used to
   * discard the URL's host and treat its path as a key in our own bucket — so
   * a URL a shop merely pasted deleted an object it had never uploaded.
   */
  it("refuses a foreign host instead of mapping its path onto our bucket", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const result = await deleteS3Image(
      "https://attacker.example.com/import-waivers/victim-scan.pdf",
      config,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses another account's bucket on the same S3 endpoint shape", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const result = await deleteS3Image(
      "https://other-bucket.s3.us-east-1.amazonaws.com/courses/x.jpg",
      config,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("import document storage — images and PDFs", () => {
  const fakePdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

  it("stores a PDF as-is, bypassing the image pipeline, with an application/pdf type and .pdf name", async () => {
    const provider = {
      upload: vi.fn().mockResolvedValue({
        status: "stored",
        url: "https://diveday-media.s3.amazonaws.com/x.pdf",
      }),
    };
    const result = await storeImportWaiverDocument(
      { filename: "waiver.pdf", contentType: "application/pdf", bytes: fakePdf },
      provider,
    );
    expect(result).toEqual({
      status: "stored",
      url: "https://diveday-media.s3.amazonaws.com/x.pdf",
    });
    expect(provider.upload).toHaveBeenCalledTimes(1);
    const arg = provider.upload.mock.calls[0][0];
    expect(arg.contentType).toBe("application/pdf");
    expect(arg.filename).toMatch(/\.pdf$/);
    // The raw PDF bytes are stored unchanged — never re-encoded to JPEG.
    expect(arg.bytes).toBe(fakePdf);
    expect(arg.keyPrefix).toBe("import-waivers");
  });

  it("stores an imported receipt through the same safe document path under its own namespace", async () => {
    const provider = {
      upload: vi.fn().mockResolvedValue({
        status: "stored",
        url: "https://diveday-media.s3.amazonaws.com/receipt.pdf",
      }),
    };
    const result = await storeImportReceiptDocument(
      { filename: "receipt.pdf", contentType: "application/pdf", bytes: fakePdf },
      provider,
    );
    expect(result).toEqual({
      status: "stored",
      url: "https://diveday-media.s3.amazonaws.com/receipt.pdf",
    });
    expect(provider.upload).toHaveBeenCalledTimes(1);
    expect(provider.upload.mock.calls[0][0]).toMatchObject({
      contentType: "application/pdf",
      keyPrefix: "import-receipts",
    });
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
      upload: vi.fn().mockResolvedValue({
        status: "stored",
        url: "https://diveday-media.s3.amazonaws.com/x.jpg",
      }),
    };
    const result = await storeImportWaiverDocument(
      { filename: "scan.jpg", contentType: "image/jpeg", bytes: realJpeg },
      provider,
    );
    expect(result).toEqual({
      status: "stored",
      url: "https://diveday-media.s3.amazonaws.com/x.jpg",
    });
    const arg = provider.upload.mock.calls[0][0];
    expect(arg.contentType).toBe("image/jpeg");
    expect(arg.filename).toMatch(/\.jpg$/);
  });
});
