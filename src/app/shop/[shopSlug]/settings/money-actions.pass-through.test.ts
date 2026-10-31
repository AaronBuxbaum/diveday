// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { redirectedTo } from "@/test/staff-session";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(async () => ({ db: true })),
  getShopById: vi.fn(),
  setShopPassThroughFee: vi.fn(),
  requireStaffSession: vi.fn(),
  paymentSettingsBlock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/shops", () => ({
  getShopById: mocks.getShopById,
  setShopPassThroughFee: mocks.setShopPassThroughFee,
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: mocks.requireStaffSession }));
vi.mock("./action-helpers", () => ({
  paymentSettingsBlock: mocks.paymentSettingsBlock,
  settingsBlock: vi.fn(),
}));

const { savePassThroughFeeAction } = await import("./money-actions");

const shop = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "reef-life",
  currency: "usd",
};
const personId = "22222222-2222-4222-8222-222222222222";
const settingsPath = shopPath(shop.slug, "settings");

function feeForm(name: string, amount: string) {
  const form = new FormData();
  form.set("passThroughName", name);
  form.set("passThroughAmount", amount);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getShopById.mockResolvedValue(shop);
  mocks.setShopPassThroughFee.mockResolvedValue(shop);
  mocks.requireStaffSession.mockResolvedValue({
    user: { shopId: shop.id, shopSlug: shop.slug, personId },
  });
});

describe("savePassThroughFeeAction", () => {
  it.each([
    ["empty", "", ""],
    ["whitespace-only", "  ", " \t"],
  ])("clears the fee when both fields are %s", async (_label, name, amount) => {
    const to = await redirectedTo(() => savePassThroughFeeAction(feeForm(name, amount)));

    expect(to).toBe(noticeUrl(settingsPath, "pass-through-saved", { saved: "passThrough" }));
    expect(mocks.setShopPassThroughFee).toHaveBeenCalledWith(expect.anything(), shop.id, null);
  });

  it.each([
    ["a missing name", "", "2.50"],
    ["a missing amount", "Park", ""],
    ["a non-number amount", "Park", "not money"],
    ["a zero amount", "Park", "0"],
    ["a negative amount", "Park", "-1"],
    ["a positive USD amount that rounds to zero minor units", "Park", "0.001"],
    ["a fee above the shared parser's minor-unit cap", "Park", "10000.01"],
  ])("refuses %s without writing", async (_label, name, amount) => {
    const to = await redirectedTo(() => savePassThroughFeeAction(feeForm(name, amount)));

    expect(to).toBe(noticeUrl(settingsPath, "pass-through-invalid", { saved: "passThrough" }));
    expect(mocks.setShopPassThroughFee).not.toHaveBeenCalled();
  });

  it("writes the parser's normalized name and accepts its exact minor-unit ceiling", async () => {
    const typedName = `  ${"P".repeat(121)}  `;
    const to = await redirectedTo(() => savePassThroughFeeAction(feeForm(typedName, "10000.00")));

    expect(to).toBe(noticeUrl(settingsPath, "pass-through-saved", { saved: "passThrough" }));
    expect(mocks.setShopPassThroughFee).toHaveBeenCalledWith(expect.anything(), shop.id, {
      name: "P".repeat(120),
      amountCents: 1_000_000,
    });
  });

  it("accepts whole-unit fees and rejects sub-unit values for a zero-decimal currency", async () => {
    mocks.getShopById.mockResolvedValue({ ...shop, currency: "jpy" });

    const acceptedTo = await redirectedTo(() => savePassThroughFeeAction(feeForm("Park", "1")));

    expect(acceptedTo).toBe(
      noticeUrl(settingsPath, "pass-through-saved", { saved: "passThrough" }),
    );
    expect(mocks.setShopPassThroughFee).toHaveBeenCalledWith(expect.anything(), shop.id, {
      name: "Park",
      amountCents: 1,
    });

    mocks.setShopPassThroughFee.mockClear();
    const rejectedTo = await redirectedTo(() => savePassThroughFeeAction(feeForm("Park", "0.4")));

    expect(rejectedTo).toBe(
      noticeUrl(settingsPath, "pass-through-invalid", { saved: "passThrough" }),
    );
    expect(mocks.setShopPassThroughFee).not.toHaveBeenCalled();
  });
});
