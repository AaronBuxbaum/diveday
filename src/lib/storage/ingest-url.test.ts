import { describe, expect, it, vi } from "vitest";
import { ingestImageUrl } from "./ingest-url";

const PUBLIC_ADDR = [{ address: "93.184.216.34", family: 4 }];
const lookupPublic = vi.fn(async () => PUBLIC_ADDR);

const storeStub = vi.fn(async (upload: { filename: string; contentType: string }) => ({
  status: "stored" as const,
  url: `https://example.public.blob.vercel-storage.com/dive-sites/x-${upload.filename}`,
}));

const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).buffer;

function okResponse(bytes: ArrayBuffer, extraHeaders: Record<string, string> = {}) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(bytes.byteLength),
      ...extraHeaders,
    },
  });
}

describe("ingestImageUrl — passthrough", () => {
  it("passes a root-relative path through unchanged, never fetching", async () => {
    const fetchImpl = vi.fn();
    const result = await ingestImageUrl("/dive-sites/bundled.jpg", storeStub, { fetchImpl });
    expect(result).toEqual({ status: "unchanged", url: "/dive-sites/bundled.jpg" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes an already-managed blob URL through unchanged, never re-fetching", async () => {
    const fetchImpl = vi.fn();
    const url = "https://store123.public.blob.vercel-storage.com/dive-sites/abc-photo.jpg";
    const result = await ingestImageUrl(url, storeStub, { fetchImpl });
    expect(result).toEqual({ status: "unchanged", url });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ingestImageUrl — malformed / disallowed input", () => {
  it("blocks an unparseable URL", async () => {
    const result = await ingestImageUrl("not a url", storeStub, { lookup: lookupPublic });
    expect(result).toEqual({ status: "blocked" });
  });

  it("blocks a non-http(s) scheme", async () => {
    const result = await ingestImageUrl("file:///etc/passwd", storeStub, { lookup: lookupPublic });
    expect(result).toEqual({ status: "blocked" });
  });
});

describe("ingestImageUrl — SSRF defenses", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["private 10/8", "10.1.2.3"],
    ["private 192.168/16", "192.168.1.1"],
    ["private 172.16/12", "172.20.0.5"],
    ["link-local / cloud metadata", "169.254.169.254"],
    ["CGNAT", "100.64.0.1"],
  ])("blocks a hostname resolving to a %s address", async (_label, address) => {
    const lookup = vi.fn(async () => [{ address, family: 4 }]);
    const result = await ingestImageUrl("https://evil.example/x.jpg", storeStub, { lookup });
    expect(result).toEqual({ status: "blocked" });
  });

  it("blocks an IPv6 loopback and link-local address", async () => {
    for (const address of ["::1", "fe80::1", "fd00::1"]) {
      const lookup = vi.fn(async () => [{ address, family: 6 }]);
      const result = await ingestImageUrl("https://evil.example/x.jpg", storeStub, { lookup });
      expect(result).toEqual({ status: "blocked" });
    }
  });

  it("blocks when ANY resolved address is private, even if another is public", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    const result = await ingestImageUrl("https://evil.example/x.jpg", storeStub, { lookup });
    expect(result).toEqual({ status: "blocked" });
  });

  it("blocks a redirect response instead of following it", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    const result = await ingestImageUrl("https://cdn.example/x.jpg", storeStub, {
      lookup: lookupPublic,
      fetchImpl,
    });
    expect(result).toEqual({ status: "blocked" });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("treats a DNS lookup failure as failed, not as an allowed request", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("NXDOMAIN");
    });
    const result = await ingestImageUrl("https://nowhere.example/x.jpg", storeStub, { lookup });
    expect(result).toEqual({ status: "failed" });
  });
});

describe("ingestImageUrl — size bounds", () => {
  it("rejects a response whose Content-Length exceeds the limit before downloading", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-type": "image/jpeg", "content-length": String(50 * 1024 * 1024) },
        }),
    );
    const result = await ingestImageUrl("https://cdn.example/huge.jpg", storeStub, {
      lookup: lookupPublic,
      fetchImpl,
    });
    expect(result).toEqual({ status: "failed" });
  });

  it("aborts a stream that exceeds the limit even when Content-Length lied", async () => {
    const bigBytes = new Uint8Array(6 * 1024 * 1024); // over MAX_IMAGE_BYTES (5MB)
    const fetchImpl = vi.fn(async () => {
      const response = new Response(bigBytes, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "10" }, // lies
      });
      return response;
    });
    const result = await ingestImageUrl("https://cdn.example/huge.jpg", storeStub, {
      lookup: lookupPublic,
      fetchImpl,
    });
    expect(result).toEqual({ status: "failed" });
  });
});

describe("ingestImageUrl — success", () => {
  it("stores the downloaded bytes and returns the provider's first-party URL", async () => {
    const fetchImpl = vi.fn(async () => okResponse(TINY_JPEG));
    storeStub.mockClear();
    const result = await ingestImageUrl("https://cdn.example/reef.jpg", storeStub, {
      lookup: lookupPublic,
      fetchImpl,
    });
    expect(result.status).toBe("stored");
    expect(storeStub).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "reef.jpg", contentType: "image/jpeg" }),
    );
  });

  it("propagates a store failure as failed rather than falling back to the raw URL", async () => {
    const fetchImpl = vi.fn(async () => okResponse(TINY_JPEG));
    const failingStore = vi.fn(async () => ({ status: "failed" as const }));
    const result = await ingestImageUrl("https://cdn.example/reef.jpg", failingStore, {
      lookup: lookupPublic,
      fetchImpl,
    });
    expect(result).toEqual({ status: "failed" });
  });

  it("distinguishes an unconfigured storage provider from a genuine failure", async () => {
    const fetchImpl = vi.fn(async () => okResponse(TINY_JPEG));
    const unconfiguredStore = vi.fn(async () => ({ status: "not_configured" as const }));
    const result = await ingestImageUrl("https://cdn.example/reef.jpg", unconfiguredStore, {
      lookup: lookupPublic,
      fetchImpl,
    });
    expect(result).toEqual({ status: "not_configured" });
  });
});
