import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops", () => ({
  getShopById: vi.fn(async () => ({ id: "shop-1", slug: "blue-mantis" })),
}));
vi.mock("@/db/counter-payment-hold", () => ({ commitCounterPaymentHold: vi.fn() }));
vi.mock("@/features/integrations", () => ({ dispatchIntegrationsAfterResponse: vi.fn() }));
vi.mock("@/lib/security-step-up", () => ({ hasRequiredStepUp: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireStaffSession: vi.fn(async () => ({ user: { shopId: "shop-1", personId: "p-1" } })),
}));

const { commitCounterPaymentHold } = await import("@/db/counter-payment-hold");
const { hasRequiredStepUp } = await import("@/lib/security-step-up");
const { dispatchIntegrationsAfterResponse } = await import("@/features/integrations");
const { POST } = await import("./route");

const HELD = "00000000-0000-4000-8000-000000000002";
const ORDER = "00000000-0000-4000-8000-000000000001";
const URL_ = `http://localhost/shop/blue-mantis/orders/${ORDER}/leave`;

function post(init: { origin?: string; heldId?: string; slug?: string } = {}) {
  const request = new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", origin: init.origin ?? "http://localhost" },
    body: JSON.stringify({ heldId: init.heldId ?? HELD }),
  });
  return POST(request, {
    params: Promise.resolve({ shopSlug: init.slug ?? "blue-mantis", id: ORDER }),
  });
}

/**
 * **The order page left inside a counter payment's hold** (review of #3061,
 * dde-a F2): recorded as the page goes, behind the release action's own gate.
 */
describe("POST orders/[id]/leave", () => {
  it("records the hold for a staffer of this shop with the money step-up", async () => {
    vi.mocked(hasRequiredStepUp).mockResolvedValueOnce(true);
    vi.mocked(commitCounterPaymentHold).mockResolvedValueOnce({
      status: "done",
      orderId: ORDER,
      outcome: { kind: "counter_payment", demo: true, outcome: { ok: true } } as never,
    });
    expect((await post()).status).toBe(204);
    expect(commitCounterPaymentHold).toHaveBeenCalledWith(expect.anything(), {
      shopId: "shop-1",
      heldId: HELD,
    });
    expect(dispatchIntegrationsAfterResponse).toHaveBeenCalled();
  });

  it("refuses another site's POST before anything is read", async () => {
    vi.mocked(commitCounterPaymentHold).mockClear();
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect(commitCounterPaymentHold).not.toHaveBeenCalled();
  });

  it("refuses without the money step-up, and records nothing", async () => {
    vi.mocked(commitCounterPaymentHold).mockClear();
    vi.mocked(hasRequiredStepUp).mockResolvedValueOnce(false);
    expect((await post()).status).toBe(403);
    expect(commitCounterPaymentHold).not.toHaveBeenCalled();
  });

  it("answers another shop's slug or a malformed id with nothing done", async () => {
    vi.mocked(commitCounterPaymentHold).mockClear();
    expect((await post({ slug: "other-shop" })).status).toBe(404);
    expect((await post({ heldId: "not-a-uuid" })).status).toBe(400);
    expect(commitCounterPaymentHold).not.toHaveBeenCalled();
  });
});
