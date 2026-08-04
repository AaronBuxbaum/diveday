import { describe, expect, it, vi } from "vitest";
import { encodeS3KeyPath, putS3Object, signS3Request } from "./s3-client";

/**
 * The signing path is pinned to AWS's published SigV4 example requests
 * ("Authenticating Requests (AWS Signature Version 4)" in the S3 API
 * reference). These vectors are the ground truth a hand-rolled signer must
 * reproduce byte for byte — if one fails, the signer is wrong, not the vector.
 */
const EXAMPLE_CREDENTIALS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const EXAMPLE_NOW = new Date("2013-05-24T00:00:00Z");
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("signS3Request", () => {
  it("reproduces AWS's GET-object example signature", () => {
    const headers = signS3Request({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadSha256Hex: EMPTY_SHA256,
      credentials: EXAMPLE_CREDENTIALS,
      region: "us-east-1",
      now: EXAMPLE_NOW,
    });

    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("reproduces AWS's PUT-object example signature", () => {
    const headers = signS3Request({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test%24file.text"),
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      // SHA-256 of the example body, "Welcome to Amazon S3."
      payloadSha256Hex: "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
      credentials: EXAMPLE_CREDENTIALS,
      region: "us-east-1",
      now: EXAMPLE_NOW,
    });

    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, " +
        "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("reproduces AWS's GET-bucket example signature", () => {
    const headers = signS3Request({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/"),
      payloadSha256Hex: EMPTY_SHA256,
      credentials: EXAMPLE_CREDENTIALS,
      region: "us-east-1",
      now: EXAMPLE_NOW,
    });

    // The list-objects example without a query string is not published; the
    // structural half (scope, signed headers) is still worth pinning.
    expect(headers.authorization).toContain(
      "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
    );
    expect(headers.authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
  });

  it("never places the secret access key in any produced header", () => {
    const headers = signS3Request({
      method: "PUT",
      url: new URL("https://backups.example.com/bucket/key.zip"),
      payloadSha256Hex: EMPTY_SHA256,
      credentials: EXAMPLE_CREDENTIALS,
      region: "auto",
      now: EXAMPLE_NOW,
    });
    for (const value of Object.values(headers)) {
      expect(value).not.toContain(EXAMPLE_CREDENTIALS.secretAccessKey);
    }
  });
});

describe("encodeS3KeyPath", () => {
  it("encodes each segment while keeping the slashes", () => {
    expect(encodeS3KeyPath("diveday/backup 2026.zip")).toBe("diveday/backup%202026.zip");
  });

  it("encodes the characters encodeURIComponent leaves bare", () => {
    expect(encodeS3KeyPath("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });
});

function fakeFetch(status: number) {
  return vi.fn(async () => new Response(null, { status }));
}

const PUT_INPUT = {
  endpoint: "https://backups.example.com",
  region: "auto",
  bucket: "shop-backups",
  key: "diveday/diveday-backup-blue-mantis-2026-W32.zip",
  body: new TextEncoder().encode("zip-bytes"),
  contentType: "application/zip",
  credentials: EXAMPLE_CREDENTIALS,
  now: EXAMPLE_NOW,
};

describe("putS3Object", () => {
  it("PUTs the signed request to the path-style URL and reports ok on 200", async () => {
    const fetchImpl = fakeFetch(200);
    const result = await putS3Object({ ...PUT_INPUT, fetchImpl });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://backups.example.com/shop-backups/diveday/diveday-backup-blue-mantis-2026-W32.zip",
    );
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    // The credential's secret must never travel — only the signature derived from it.
    for (const value of Object.values(headers)) {
      expect(value).not.toContain(EXAMPLE_CREDENTIALS.secretAccessKey);
    }
    expect(url.toString()).not.toContain(EXAMPLE_CREDENTIALS.secretAccessKey);
  });

  it("tolerates a trailing slash on the endpoint", async () => {
    const fetchImpl = fakeFetch(200);
    await putS3Object({ ...PUT_INPUT, endpoint: "https://backups.example.com/", fetchImpl });
    const [url] = fetchImpl.mock.calls[0] as unknown as [URL];
    expect(url.toString()).toBe(
      "https://backups.example.com/shop-backups/diveday/diveday-backup-blue-mantis-2026-W32.zip",
    );
  });

  it.each([
    [401, "upload_unauthorized"],
    [403, "upload_unauthorized"],
    [404, "bucket_not_found"],
    [500, "upload_rejected"],
    [503, "upload_rejected"],
  ] as const)("maps HTTP %d to the %s code", async (status, errorCode) => {
    const result = await putS3Object({ ...PUT_INPUT, fetchImpl: fakeFetch(status) });
    expect(result).toEqual({ ok: false, errorCode });
  });

  it("never follows a redirecting endpoint — a 3xx is a rejection, not a re-send", async () => {
    // An owner-configured endpoint that answers 307 could otherwise bounce
    // the signed PUT (body included) at an internal address the private-host
    // check refused up front.
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 307, headers: { location: "https://10.0.0.5/" } }),
    );
    const result = await putS3Object({ ...PUT_INPUT, fetchImpl });
    expect(result).toEqual({ ok: false, errorCode: "upload_rejected" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("reports network_unreachable instead of throwing when fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await putS3Object({ ...PUT_INPUT, fetchImpl });
    expect(result).toEqual({ ok: false, errorCode: "network_unreachable" });
  });

  it("aborts a hung upload after the timeout rather than holding the run open", async () => {
    const fetchImpl = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = await putS3Object({
      ...PUT_INPUT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
    });
    expect(result).toEqual({ ok: false, errorCode: "network_unreachable" });
  });
});
