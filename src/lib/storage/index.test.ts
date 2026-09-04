import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deleteS3Image,
  deleteStoredImage,
  deleteStoredImageTracked,
  imageStorageProviderFromEnvironment,
  isManagedStorageUrl,
  MAX_COURSE_IMAGE_BYTES,
  managedImageRemotePatterns,
  mediaStorageConfigFromEnvironment,
  readS3Object,
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

/**
 * **The `next/image` allowlist, which is the same list one layer out**
 * (issue #1358).
 *
 * `next.config.ts` calls this at build time. It carried three wildcards until
 * 2026-09-04 — `*.s3.*.amazonaws.com`, `*.s3.amazonaws.com`, `*.cloudfront.net`
 * — so `/_next/image?url=…` would fetch and re-serve any object behind any
 * public bucket or any distribution on the internet. The cases below are the
 * `isManagedStorageUrl` cases above, asked of the allowlist instead of the
 * predicate, because the whole point of deriving one from the other is that
 * they cannot answer differently.
 */
describe("managedImageRemotePatterns", () => {
  it("names the configured bucket's two endpoints, and nothing wildcarded", () => {
    expect(managedImageRemotePatterns(mockS3Env)).toEqual([
      { protocol: "https", hostname: "diveday-media.s3.amazonaws.com", port: "", pathname: "/**" },
      {
        protocol: "https",
        hostname: "diveday-media.s3.us-east-1.amazonaws.com",
        port: "",
        pathname: "/**",
      },
    ]);
  });

  it("names the deployed distribution when there is one", () => {
    const env = { ...mockS3Env, MEDIA_PUBLIC_URL_BASE: "https://d1234abcd.cloudfront.net" };
    expect(managedImageRemotePatterns(env)[0]).toEqual({
      protocol: "https",
      hostname: "d1234abcd.cloudfront.net",
      port: "",
      pathname: "/**",
    });
  });

  /**
   * The finding itself. A pattern matches by hostname, so the assertion that
   * bites is that no hostname contains a `*` — a `*.cloudfront.net` here is an
   * open image proxy however it got written.
   */
  it("emits no wildcard hostname, which is the whole of the fix", () => {
    const env = { ...mockS3Env, MEDIA_PUBLIC_URL_BASE: "https://d1234abcd.cloudfront.net" };
    const hostnames = managedImageRemotePatterns(env).map((pattern) => pattern.hostname);
    expect(hostnames).toHaveLength(3);
    for (const hostname of hostnames) expect(hostname).not.toContain("*");
  });

  it("refuses a cleartext base rather than letting the optimizer downgrade", () => {
    const env = { ...mockS3Env, MEDIA_PUBLIC_URL_BASE: "http://media.diveday.test" };
    expect(managedImageRemotePatterns(env).map((pattern) => pattern.hostname)).not.toContain(
      "media.diveday.test",
    );
  });

  /**
   * An empty allowlist, not a fallback wildcard. Nothing the seed or the
   * bundled templates render is remote — every one is a root-relative path
   * under `public/` — and an upload with no storage configured stores no URL at
   * all, so there is nothing for a pattern to permit.
   */
  it("allows nothing at all when no media storage is configured", () => {
    expect(managedImageRemotePatterns({})).toEqual([]);
  });

  it("survives an unparseable base instead of failing the build", () => {
    const env = { ...mockS3Env, MEDIA_PUBLIC_URL_BASE: "not a url" };
    expect(managedImageRemotePatterns(env)).toHaveLength(2);
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

  /**
   * **The delete twin of the read path's encoded-separator case** (issue
   * #1349). The origin check above constrains the *host*; until this guard,
   * nothing constrained the *key*, and there is no prefix here to constrain it
   * with — these callers delete across nine namespaces.
   *
   * The mechanics are the same: `%2F` is one path segment to the URL parser,
   * so nothing folds on the way in; the key decodes with the `..` intact;
   * `encodeS3KeyPath` does not encode dots; and the `new URL()` that builds the
   * request folds it, so the *signed* path is somewhere else entirely.
   *
   * What makes it worth refusing even though no caller can reach it is the
   * deletion ledger: `queueAndAttemptMediaDeletion` records the URL it was
   * given, so a folding key leaves a row asserting one object was removed
   * while S3 lost another. Unlike the read path there is no IAM backstop —
   * `DeleteObject` is granted on the whole bucket.
   */
  it("refuses a url whose signed path is not the object it names", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const result = await deleteS3Image(
      "https://diveday-media.s3.us-east-1.amazonaws.com/recap%2F..%2Fimport-waivers%2Fvictim.pdf",
      config,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /**
   * The guard is an equality against the key, so it has to leave alone every
   * key we actually write — spaces, parentheses and non-ASCII all survive
   * `encodeS3KeyPath` as percent-escapes the URL parser passes through
   * untouched. A guard that refused these would fail closed on real uploads.
   */
  it("still deletes a key carrying spaces, parentheses and non-ASCII", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const result = await deleteS3Image(
      "https://diveday-media.s3.us-east-1.amazonaws.com/shop-logos/pe%C3%B1a%20cove%20(2).png",
      config,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

/**
 * **The only way back to a stored physician's evaluation** (issue #1283). The
 * media bucket blocks all public access and `medical-clearances/` has no
 * CloudFront behaviour, so nothing else can fetch these bytes — which makes
 * the two refusals below the whole of the security story, since a URL reaching
 * this function comes out of a database column.
 */
describe("readS3Object", () => {
  const config = {
    bucket: "diveday-media",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  };
  const ok = (contentType: string) =>
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4").buffer,
      headers: new Headers({ "content-type": contentType }),
    }));

  it("signs a GET for an object in the named prefix and returns its bytes", async () => {
    const fetchImpl = ok("application/pdf");
    const result = await readS3Object(
      "https://diveday-media.s3.us-east-1.amazonaws.com/medical-clearances/abc.pdf",
      config,
      { prefix: "medical-clearances" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contentType).toBe("application/pdf");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/medical-clearances/abc.pdf");
    expect(init.method).toBe("GET");
    // Signed as the uploader credential — never a presigned URL, which would
    // outlive the permission check that minted it.
    expect((init.headers as Record<string, string>).authorization).toContain("AWS4-HMAC-SHA256");
  });

  /**
   * The same host binding `deleteS3Image` keeps, and for a stronger reason:
   * this URL comes from a column, so a bad row must not become a request
   * signed with the shop's credential against a host of somebody's choosing.
   */
  it("refuses a foreign host rather than signing a request at it", async () => {
    const fetchImpl = ok("application/pdf");
    const result = await readS3Object(
      "https://attacker.example.com/medical-clearances/victim.pdf",
      config,
      { prefix: "medical-clearances" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /**
   * The prefix is the caller's word, not the column's. IAM grants `GetObject`
   * on `medical-clearances/*` and nothing else, so a key outside it would be a
   * 403 anyway — but the refusal belongs here, where it can be read.
   */
  /**
   * **The escape that survives every obvious guard.** Encoding the *dots* is
   * dead: `new URL()` folds `/a/../b` and `/a/%2e%2e/b` alike, so neither
   * reaches the check. Encoding the **separators** does not fold — the whole
   * thing is one path segment to the parser — so it decodes to a key that
   * begins with the prefix and then normalizes, on the way into the signature,
   * to somewhere else entirely.
   *
   * The signed path is `/import-waivers/victim.pdf`: another diver's imported
   * waiver scan. IAM refuses it today, because `GetObject` is granted on this
   * prefix and no other — but a 403 nobody reads is exactly what naming the
   * prefix was meant to replace, and the guard has to hold on its own terms.
   */
  it("refuses a key that walks out of the prefix through encoded separators", async () => {
    const fetchImpl = ok("application/pdf");
    const result = await readS3Object(
      "https://diveday-media.s3.us-east-1.amazonaws.com/medical-clearances%2F..%2Fimport-waivers%2Fvictim.pdf",
      config,
      { prefix: "medical-clearances" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a key outside the prefix the caller named", async () => {
    const fetchImpl = ok("image/jpeg");
    const result = await readS3Object(
      "https://diveday-media.s3.us-east-1.amazonaws.com/import-waivers/someone-else.pdf",
      config,
      { prefix: "medical-clearances" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a provider refusal rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, headers: new Headers() }));
    const result = await readS3Object(
      "https://diveday-media.s3.us-east-1.amazonaws.com/medical-clearances/abc.pdf",
      config,
      { prefix: "medical-clearances" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, error: "provider responded 403" });
  });
});

/**
 * **The variable names the media path reads are the ones the registry
 * declares** (issue #1283).
 *
 * `/api/medical-clearances/[recordId]` read `MEDIA_S3_BUCKET`,
 * `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID` and `MEDIA_S3_SECRET_ACCESS_KEY`
 * -- four names produced by no stack output and declared in no registry. The
 * parse failed in every deployed environment and the route's own "not
 * configured" branch turned that into a 404, so a shop stored the most
 * sensitive document the product holds and could never open it.
 *
 * It was green because the route's test stubbed the same wrong names. Two
 * copies of a mistake agreeing with each other is not a passing test, so this
 * asserts against `config/env-registry.mjs` -- the one place that says which
 * variables exist and who produces them -- rather than against another literal
 * in the tree.
 */
describe("mediaStorageConfigFromEnvironment", () => {
  const REQUIRED = [
    "MEDIA_BUCKET_NAME",
    "MEDIA_AWS_REGION",
    "MEDIA_AWS_ACCESS_KEY_ID",
    "MEDIA_AWS_SECRET_ACCESS_KEY",
    "MEDIA_PUBLIC_URL_BASE",
  ] as const;

  it("reads names the environment registry actually declares", () => {
    const registry = readFileSync(path.join(process.cwd(), "config/env-registry.mjs"), "utf8");
    for (const name of REQUIRED) {
      expect(registry, `${name} is not declared in config/env-registry.mjs`).toContain(
        `key: "${name}"`,
      );
    }
  });

  it("parses a fully configured environment", () => {
    const parsed = mediaStorageConfigFromEnvironment({
      MEDIA_BUCKET_NAME: "diveday-media",
      MEDIA_AWS_REGION: "us-east-1",
      MEDIA_AWS_ACCESS_KEY_ID: "AKIA-test",
      MEDIA_AWS_SECRET_ACCESS_KEY: "secret",
      MEDIA_PUBLIC_URL_BASE: "https://media.example.com",
    });
    expect(parsed.success).toBe(true);
  });

  /**
   * The exact shape of the bug: an environment carrying the names the route
   * used to read, and nothing else, must not look configured.
   */
  it("does not accept the MEDIA_S3_* names the medical-clearance route used to read", () => {
    const parsed = mediaStorageConfigFromEnvironment({
      MEDIA_S3_BUCKET: "diveday-media",
      MEDIA_S3_REGION: "us-east-1",
      MEDIA_S3_ACCESS_KEY_ID: "AKIA-test",
      MEDIA_S3_SECRET_ACCESS_KEY: "secret",
      MEDIA_PUBLIC_URL_BASE: "https://media.example.com",
    });
    expect(parsed.success).toBe(false);
  });
});
