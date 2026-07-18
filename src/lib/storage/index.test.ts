import { describe, expect, it, vi } from "vitest";
import { imageStorageProviderFromEnvironment, MAX_CARD_IMAGE_BYTES, storeCardImage } from "./index";

function upload(overrides: Partial<Parameters<typeof storeCardImage>[0]> = {}) {
  return {
    keyPrefix: "cards",
    filename: "padi ow.jpg",
    contentType: "image/jpeg",
    bytes: new ArrayBuffer(1024),
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
    expect(init.headers.authorization).toBe("Bearer test-token");
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
