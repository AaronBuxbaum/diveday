import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/features/people/person-photo", () => ({ getDiverPhotoForCapability: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  mediaStorageConfigFromEnvironment: vi.fn(() => ({ success: true, data: {} })),
  readS3Object: vi.fn(),
}));

import { getDiverPhotoForCapability } from "@/features/people/person-photo";
import { readS3Object } from "@/lib/storage";
import { GET } from "./route";

const url = "https://media.example/private-person-photos/AAAAAAAAAAAAAAAAAAAAAA.jpg";
const assetId = "AAAAAAAAAAAAAAAAAAAAAA.jpg";
const request = () => new Request("https://example.test/ready/token/photo/a");
const params = () => ({ params: Promise.resolve({ token: "token", assetId }) });

beforeEach(() => vi.clearAllMocks());

describe("diver photo preview", () => {
  it("reads only the current photo resolved from the capability and does not cache", async () => {
    vi.mocked(getDiverPhotoForCapability).mockResolvedValue({ url, assetId });
    vi.mocked(readS3Object).mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1]).buffer,
      contentType: "image/jpeg",
    });
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getDiverPhotoForCapability).toHaveBeenCalledWith(expect.anything(), {
      token: "token",
      assetId,
    });
    expect(readS3Object).toHaveBeenCalledWith(url, expect.anything(), {
      prefix: "private-person-photos",
    });
  });

  it("returns a non-cacheable 404 without fetching when authorization or the reference fails", async () => {
    vi.mocked(getDiverPhotoForCapability).mockResolvedValue(null);
    const response = await GET(request(), params());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(readS3Object).not.toHaveBeenCalled();
  });
});
