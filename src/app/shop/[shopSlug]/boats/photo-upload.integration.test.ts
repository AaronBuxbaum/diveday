import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBoat, getBoatById } from "@/db/boats";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

const ctx = fileScopedShopContext();
const fakeStorage = vi.hoisted(() => ({
  uploads: [] as Array<{ contentType: string; bytes: number }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: (_page: string, url: string) => {
    throw new Error(url);
  },
}));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("../register-block", () => ({ registerBlock: vi.fn() }));
vi.mock("@/lib/storage", async (original) => {
  const actual = await original<typeof import("@/lib/storage")>();
  return {
    ...actual,
    storeShopHeroImage: (upload: Parameters<typeof actual.storeShopHeroImage>[0]) =>
      actual.storeShopHeroImage(upload, {
        upload: async (image) => {
          fakeStorage.uploads.push({
            contentType: image.contentType,
            bytes: image.bytes.byteLength,
          });
          return {
            status: "stored" as const,
            url: `https://diveday-media.s3.us-east-1.amazonaws.com/shop-heroes/test-${fakeStorage.uploads.length}.jpg`,
          };
        },
      }),
  };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { updateBoatAction } = await import("./actions");

beforeEach(() => {
  fakeStorage.uploads.length = 0;
});

describe("boat photo upload", () => {
  it("processes a photo, saves and replaces it on the real boat, then removes it", async () => {
    const { db, shop } = ctx;
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    );
    const boat = await createBoat(db, shop.id, "Photo boat", 8);
    const form = () => {
      const data = new FormData();
      data.set("boatId", boat.id);
      data.set("name", boat.name);
      data.set("capacity", "8");
      return data;
    };
    const image = readFileSync("public/icon-512.png");
    for (let expected = 1; expected <= 2; expected++) {
      const data = form();
      data.set("boatPhoto", new File([image], "boat.png", { type: "image/png" }));
      await expect(updateBoatAction(data)).rejects.toThrow("boat-updated");
      expect((await getBoatById(db, shop.id, boat.id))?.photoUrl).toContain(`test-${expected}.jpg`);
    }
    expect(fakeStorage.uploads).toEqual([
      expect.objectContaining({ contentType: "image/jpeg", bytes: expect.any(Number) }),
      expect.objectContaining({ contentType: "image/jpeg", bytes: expect.any(Number) }),
    ]);
    const remove = form();
    remove.set("removeBoatPhoto", "true");
    await expect(updateBoatAction(remove)).rejects.toThrow("boat-updated");
    expect((await getBoatById(db, shop.id, boat.id))?.photoUrl).toBeNull();
  });
});
