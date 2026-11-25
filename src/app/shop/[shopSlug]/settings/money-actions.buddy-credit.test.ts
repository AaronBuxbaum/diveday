// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { redirectedTo } from "@/test/staff-session";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(async () => ({ db: true })),
  getShopById: vi.fn(),
  setShopPassThroughFee: vi.fn(),
  setShopBuddyCredit: vi.fn(),
  requireStaffSession: vi.fn(),
  canPersonManagePaymentSettings: vi.fn(async () => true),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("../../../../features/platform/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/shops", () => ({
  getShopById: mocks.getShopById,
  setShopPassThroughFee: mocks.setShopPassThroughFee,
  setShopBuddyCredit: mocks.setShopBuddyCredit,
}));
vi.mock("../../../../features/accounts/session", () => ({
  requireStaffSession: mocks.requireStaffSession,
}));
vi.mock("@/db/authz", () => ({
  canPersonManagePaymentSettings: mocks.canPersonManagePaymentSettings,
  canPersonManageShopSettings: vi.fn(async () => true),
}));

const { saveBuddyCreditAction } = await import("./money-actions");

const shop = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "reef-life",
  currency: "usd",
};
const settingsPath = shopPath(shop.slug, "settings");
const extra = { saved: "buddyCredit" };

function creditForm(amount: string) {
  const form = new FormData();
  form.set("buddyCreditAmount", amount);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getShopById.mockResolvedValue(shop);
  mocks.requireStaffSession.mockResolvedValue({
    user: {
      shopId: shop.id,
      shopSlug: shop.slug,
      personId: "22222222-2222-4222-8222-222222222222",
    },
  });
});

describe("saveBuddyCreditAction", () => {
  it.each([
    ["25", 2_500],
    ["", 0],
    ["0", 0],
  ])("saves %j as %i cents", async (amount, cents) => {
    const to = await redirectedTo(() => saveBuddyCreditAction(creditForm(amount)));
    expect(to).toBe(noticeUrl(settingsPath, "buddy-credit-saved", extra));
    expect(mocks.setShopBuddyCredit).toHaveBeenCalledWith(expect.anything(), shop.id, cents);
  });

  it.each(["-5", "lots", "10000.01"])("refuses %j and saves nothing", async (amount) => {
    const to = await redirectedTo(() => saveBuddyCreditAction(creditForm(amount)));
    expect(to).toBe(noticeUrl(settingsPath, "buddy-credit-invalid", extra));
    expect(mocks.setShopBuddyCredit).not.toHaveBeenCalled();
  });

  it("is refused to staff who may not manage payments", async () => {
    mocks.canPersonManagePaymentSettings.mockResolvedValueOnce(false);
    const to = await redirectedTo(() => saveBuddyCreditAction(creditForm("25")));
    expect(to).toBe(noticeUrl(settingsPath, "not-authorized"));
    expect(mocks.setShopBuddyCredit).not.toHaveBeenCalled();
  });
});
