import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  replace: vi.fn(),
  upload: vi.fn(),
  queue: vi.fn(),
  block: vi.fn(),
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
vi.mock("@/lib/session", () => ({
  requireStaffSession: async () => ({
    user: { shopSlug: "blue-mantis", shopId: "our-shop", personId: "staff" },
  }),
}));
vi.mock("../register-block", () => ({ registerBlock: mocks.block }));
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/authz", () => ({ canPersonManageBoats: vi.fn() }));
vi.mock("@/db/shops", () => ({ getShopById: async () => ({ timezone: "UTC" }) }));
vi.mock("@/db/boats", () => ({
  createBoat: vi.fn(),
  deleteBoat: vi.fn(),
  updateBoatWithinCertificate: mocks.save,
  replaceBoatPhoto: mocks.replace,
}));
vi.mock("@/db/media-deletions", () => ({ queueAndAttemptMediaDeletion: mocks.queue }));
vi.mock("@/lib/storage", () => ({
  MAX_SHOP_HERO_BYTES: 5 * 1024 * 1024,
  storeShopHeroImage: mocks.upload,
}));

import { updateBoatAction } from "./actions";

const id = "c745f02b-9479-4904-9b99-f527104a30b0";
function form() {
  const data = new FormData();
  data.set("boatId", id);
  data.set("name", "Manta");
  data.set("capacity", "8");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.block.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ ok: true, boat: { photoUrl: "old" } });
  mocks.replace.mockResolvedValue(true);
  mocks.upload.mockResolvedValue({ status: "stored", url: "new" });
  mocks.queue.mockResolvedValue(undefined);
});

describe("boat photo save", () => {
  it("uploads a picked photo and writes only to the session's shop", async () => {
    const data = form();
    data.set("boatPhoto", new File(["image"], "boat.png", { type: "image/png" }));
    await expect(updateBoatAction(data)).rejects.toThrow("boat-updated");
    expect(mocks.block).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith(expect.anything(), "our-shop", id, "old", "new");
  });

  it("queues the new upload when a concurrent edit wins", async () => {
    mocks.replace.mockResolvedValue(false);
    const data = form();
    data.set("boatPhoto", new File(["image"], "boat.png", { type: "image/png" }));
    await expect(updateBoatAction(data)).rejects.toThrow("boat-photo-invalid");
    expect(mocks.queue).toHaveBeenCalledWith(expect.anything(), {
      shopId: "our-shop",
      kind: "boat_photo",
      url: "new",
    });
  });

  it("does not change a saved photo when storage refuses the upload", async () => {
    mocks.upload.mockResolvedValue({ status: "failed" });
    const data = form();
    data.set("boatPhoto", new File(["image"], "boat.png", { type: "image/png" }));
    await expect(updateBoatAction(data)).rejects.toThrow("boat-photo-invalid");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
