import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/features/accounts/session", () => ({ isLiveShopStaff: vi.fn() }));
vi.mock("@/features/people/person-photo", () => ({ currentPrivatePersonPhoto: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  mediaStorageConfigFromEnvironment: vi.fn(),
  readS3Object: vi.fn(),
}));

import { getDb } from "@/db/client";
import { isLiveShopStaff } from "@/features/accounts/session";
import { currentPrivatePersonPhoto } from "@/features/people/person-photo";
import { auth } from "@/lib/auth";
import { mediaStorageConfigFromEnvironment, readS3Object } from "@/lib/storage";
import { GET } from "./route";

const assetId = "abcdefghijklmnopqrstuv.jpg";
const personId = "00000000-0000-4000-8000-000000000001";
const params = (asset = assetId) => ({ params: Promise.resolve({ personId, assetId: asset }) });
const request = new Request("https://example.test/api/person-photos/example");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { shopId: "shop", personId: "staff" } } as never);
  vi.mocked(getDb).mockResolvedValue({} as never);
  vi.mocked(isLiveShopStaff).mockResolvedValue(true);
  vi.mocked(currentPrivatePersonPhoto).mockResolvedValue(
    `https://media.example/private-person-photos/${assetId}`,
  );
  vi.mocked(mediaStorageConfigFromEnvironment).mockReturnValue({
    success: true,
    data: {},
  } as never);
  vi.mocked(readS3Object).mockResolvedValue({
    ok: true,
    bytes: new ArrayBuffer(1),
    contentType: "image/jpeg",
  });
});

describe("private person photo GET", () => {
  it("returns the current asset to live staff with no shared caching", async () => {
    const response = await GET(request, params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(currentPrivatePersonPhoto).toHaveBeenCalledWith(
      expect.anything(),
      "shop",
      personId,
      assetId,
    );
    expect(readS3Object).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      prefix: "private-person-photos",
    });
  });

  it("refuses signed-out, revoked, malformed, missing and replaced assets without reading storage", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null);
    expect((await GET(request, params())).status).toBe(404);
    vi.mocked(isLiveShopStaff).mockResolvedValueOnce(false);
    expect((await GET(request, params())).status).toBe(404);
    expect((await GET(request, params("old.jpg"))).status).toBe(404);
    vi.mocked(currentPrivatePersonPhoto).mockResolvedValueOnce(null);
    const missing = await GET(request, params());
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    expect(readS3Object).not.toHaveBeenCalled();
  });

  it("does not cache failed storage reads or authorization errors", async () => {
    vi.mocked(readS3Object).mockRejectedValueOnce(new Error("storage failed"));
    const failed = await GET(request, params());
    expect(failed.status).toBe(404);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    vi.mocked(isLiveShopStaff).mockRejectedValueOnce(new Error("database failed"));
    const unavailable = await GET(request, params());
    expect(unavailable.status).toBe(404);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
  });
});
