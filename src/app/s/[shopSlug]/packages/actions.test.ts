// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";

/**
 * Buying a dive package is an anonymous endpoint that raises a Stripe invoice
 * on the shop's account, so these pin what a visitor can and cannot steer:
 * which shop (the URL's, bound server-side), which package (only one on
 * sale), and never the price.
 */

const hoisted = vi.hoisted(() => ({
  createDiverPackageOrder: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: hoisted.redirect }));
vi.mock("@/db/orders", () => ({ createDiverPackageOrder: hoisted.createDiverPackageOrder }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { buyPackageAction } = await import("./actions");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { createDivePackage } = await import("@/db/dive-packages");
const { getDb } = await import("@/db/client");

beforeEach(() => {
  hoisted.createDiverPackageOrder.mockReset();
  hoisted.redirect.mockClear();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

async function shopWithPackage(validUntil: string | null = null) {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const pkg = await createDivePackage(db, {
    shopId: shop.id,
    name: "Ten-dive card",
    diveCount: 10,
    priceCents: 45_000,
    scope: "all",
    validUntil,
  });
  if (!pkg) throw new Error("package not created");
  return { shop, pkg };
}

function purchaseForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("buyPackageAction", () => {
  it("raises the order for the URL's shop and sends the diver to Stripe's page", async () => {
    const { shop, pkg } = await shopWithPackage();
    hoisted.createDiverPackageOrder.mockResolvedValue({
      ok: true,
      order: { hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_1/in_1" },
    });
    await expect(
      buyPackageAction(
        shop.slug,
        {},
        purchaseForm({
          packageId: pkg.id,
          name: "Ola Online",
          email: "Ola@Example.com",
          // Posted, and ignored: the price is the package row's.
          priceCents: "1",
          shopId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT https://invoice.stripe.com/i/acct_1/in_1");
    expect(hoisted.createDiverPackageOrder).toHaveBeenCalledTimes(1);
    const [, input] = hoisted.createDiverPackageOrder.mock.calls[0] ?? [];
    expect(input).toEqual({
      shopId: shop.id,
      packageId: pkg.id,
      fullName: "Ola Online",
      email: "ola@example.com",
      lineDescription: "Ten-dive card, 10 dives",
    });
  });

  it("refuses a package that is not on sale before anything is raised", async () => {
    const { shop, pkg } = await shopWithPackage("2020-01-01");
    const state = await buyPackageAction(
      shop.slug,
      {},
      purchaseForm({ packageId: pkg.id, name: "Rae", email: "rae@example.com" }),
    );
    expect(state.error).toBe("That package isn’t on sale anymore.");
    expect(hoisted.createDiverPackageOrder).not.toHaveBeenCalled();
  });

  it("asks for a name and an email it can use", async () => {
    const { shop, pkg } = await shopWithPackage();
    const state = await buyPackageAction(
      shop.slug,
      {},
      purchaseForm({ packageId: pkg.id, name: " ", email: "not-an-email" }),
    );
    expect(state.error).toBe("Add your name and an email we can reach you at.");
    expect(hoisted.createDiverPackageOrder).not.toHaveBeenCalled();
  });

  it("stops a visitor who keeps tapping Buy before Stripe is asked again", async () => {
    const { shop, pkg } = await shopWithPackage();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });
    const state = await buyPackageAction(
      shop.slug,
      {},
      purchaseForm({ packageId: pkg.id, name: "Ola", email: "ola@example.com" }),
    );
    expect(state.error).toMatch(/wait a few minutes/);
    expect(hoisted.createDiverPackageOrder).not.toHaveBeenCalled();
  });

  it("never redirects anywhere but an https page", async () => {
    const { shop, pkg } = await shopWithPackage();
    hoisted.createDiverPackageOrder.mockResolvedValue({
      ok: true,
      order: { hostedInvoiceUrl: "javascript:alert(1)" },
    });
    const state = await buyPackageAction(
      shop.slug,
      {},
      purchaseForm({ packageId: pkg.id, name: "Ola", email: "ola@example.com" }),
    );
    expect(state.error).toBe(
      "The payment page didn’t open. Nothing was charged. Try again in a moment.",
    );
    expect(hoisted.redirect).not.toHaveBeenCalled();
  });

  it("names the shop when it cannot take the payment online", async () => {
    const { shop, pkg } = await shopWithPackage();
    hoisted.createDiverPackageOrder.mockResolvedValue({ ok: false, reason: "not_connected" });
    const state = await buyPackageAction(
      shop.slug,
      {},
      purchaseForm({ packageId: pkg.id, name: "Ola", email: "ola@example.com" }),
    );
    expect(state.error).toBe(
      `${shop.name} can’t take this payment online right now. Get in touch and they’ll sort it out.`,
    );
    // React resets the form after the action; the answers come back with the
    // refusal so a retry is one tap, not a retype.
    expect(state).toMatchObject({ name: "Ola", email: "ola@example.com", packageId: pkg.id });
  });
});
