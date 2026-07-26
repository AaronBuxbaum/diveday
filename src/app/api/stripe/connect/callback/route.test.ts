import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireStaffSession: vi.fn(),
}));
vi.mock("@/db/authz", () => ({
  canPersonManagePaymentSettings: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/db/shops", () => ({
  getShopById: vi.fn(),
}));
vi.mock("@/db/stripe-accounts", () => ({
  upsertShopStripeAccount: vi.fn(),
  setShopStripeAccountStatus: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  publicAppUrl: vi.fn(() => "https://shop.example.com"),
}));
vi.mock("@/lib/payments/connect", () => ({
  connectProviderFromEnvironment: vi.fn(),
  STRIPE_CONNECT_STATE_COOKIE: "stripe_connect_state",
  stripeConnectCallbackUrl: vi.fn(() => "https://shop.example.com/api/stripe/connect/callback"),
}));

const { cookies } = await import("next/headers");
const { requireStaffSession } = await import("@/lib/session");
const { canPersonManagePaymentSettings } = await import("@/db/authz");
const { getDb } = await import("@/db/client");
const { getShopById } = await import("@/db/shops");
const { upsertShopStripeAccount } = await import("@/db/stripe-accounts");
const { connectProviderFromEnvironment } = await import("@/lib/payments/connect");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };

function request(state: string) {
  return new Request(`http://localhost/api/stripe/connect/callback?code=ac_1&state=${state}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: "shop_1", shopSlug: "reef", personId: "person_1" },
  } as never);
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => ({ value: "nonce_1" })),
    delete: vi.fn(),
  } as never);
});

describe("stripe connect callback authorization", () => {
  it("refuses to link the account and redirects with not_authorized when the staff member can no longer manage payment settings", async () => {
    vi.mocked(canPersonManagePaymentSettings).mockResolvedValue(false);

    const response = await GET(request("nonce_1"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/shop/reef/settings");
    expect(location.searchParams.get("notice")).toBe("not_authorized");
    // The state cookie round trip and demo-shop checks never even matter here:
    // authorization is re-checked against live roles before any account is linked.
    expect(getShopById).not.toHaveBeenCalled();
    expect(connectProviderFromEnvironment).not.toHaveBeenCalled();
    expect(upsertShopStripeAccount).not.toHaveBeenCalled();
  });

  it("checks the initiating person's live role, not just that they hold a staff session", async () => {
    vi.mocked(canPersonManagePaymentSettings).mockResolvedValue(false);

    await GET(request("nonce_1"));

    expect(canPersonManagePaymentSettings).toHaveBeenCalledWith(FAKE_DB, "shop_1", "person_1");
  });
});
