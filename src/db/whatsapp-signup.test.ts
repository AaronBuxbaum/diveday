import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { shops } from "./schema";
import {
  connectShopWhatsAppAccount,
  getShopWhatsAppAccount,
  shopIdForWhatsAppWaba,
} from "./whatsapp-accounts";
import { completeWhatsAppSignup } from "./whatsapp-signup";

const key = randomBytes(32);
const config = { appId: "app-1", appSecret: "app-secret", configId: "config-1" };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

/** Meta answering every step: exchange, register, subscribe, template. */
function metaFetch(exchange: Response = json(200, { access_token: "EAAG-token" })) {
  const answers = [
    exchange,
    json(200, { success: true }),
    json(200, { success: true }),
    json(200, { id: "template-1", status: "PENDING" }),
  ];
  let call = 0;
  return vi.fn().mockImplementation(async () => answers[call++] ?? json(200, {}));
}

function signup(shopId: string, overrides: Partial<{ code: string; wabaId: string }> = {}) {
  return {
    shopId,
    code: "AQD-signup-code",
    wabaId: "waba_signup",
    phoneNumberId: "1234567890",
    templateName: "diveday_courtesy_update",
    templateLanguage: "en_US",
    templateCopy: {
      body: "Hi! An update from {{1}}: {{2}}",
      exampleShopName: "Blue Mantis Divers",
      exampleMessage: "Reef Runner departs Saturday at 8:00 AM.",
    },
    ...overrides,
  };
}

async function siblingShop(db: AppDb, slug: string) {
  const [sibling] = await db
    .insert(shops)
    .values({ name: "Sibling Shop", slug, timezone: "UTC" })
    .returning();
  if (!sibling) throw new Error("second shop insert failed");
  return sibling;
}

const urls = (fetchImpl: ReturnType<typeof metaFetch>) =>
  fetchImpl.mock.calls.map((call: unknown[]) => String(call[0]));

describe("completeWhatsAppSignup", () => {
  it("exchanges, registers once, and stores the connection", async () => {
    const { db, shop } = await seededShopContext();
    const fetchImpl = metaFetch();
    const newPin = vi.fn(() => "123456");

    const outcome = await completeWhatsAppSignup(db, signup(shop.id), config, {
      fetchImpl,
      newPin,
      sender: { key },
    });

    expect(outcome).toBe("connected");
    expect(newPin).toHaveBeenCalledTimes(1);
    expect(urls(fetchImpl)[1]).toContain("/register");
    expect(await shopIdForWhatsAppWaba(db, "waba_signup")).toBe(shop.id);
  });

  /**
   * **A junk code learns nothing about other shops** (issue #1766). The WABA
   * check runs only after Meta has accepted the code, so a post naming a WABA
   * another DiveDay shop holds, with ten junk characters for a code, reads the
   * same refusal as one naming a WABA nobody holds.
   */
  it("refuses a bad code before asking who holds the WABA", async () => {
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-signup-oracle");
    await connectShopWhatsAppAccount(
      db,
      {
        shopId: sibling.id,
        phoneNumberId: "999",
        accessToken: "t",
        templateName: "x",
        templateLanguage: "en_US",
        wabaId: "waba_signup",
      },
      { key },
    );
    const fetchImpl = metaFetch(json(400, { error: { message: "Invalid code", code: 100 } }));
    const newPin = vi.fn(() => "123456");

    const outcome = await completeWhatsAppSignup(
      db,
      signup(shop.id, { code: "junkjunkjunk" }),
      config,
      { fetchImpl, newPin, sender: { key } },
    );

    expect(outcome).toBe("signup_failed_exchange");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(newPin).not.toHaveBeenCalled();
  });

  /**
   * **Refused before any number is registered** (issue #1769). A valid code for
   * a WABA another shop holds stops after the exchange: no PIN is minted and
   * nothing reaches the register step.
   */
  it("refuses a WABA another shop holds after the exchange and before registering", async () => {
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-signup-held");
    await connectShopWhatsAppAccount(
      db,
      {
        shopId: sibling.id,
        phoneNumberId: "999",
        accessToken: "t",
        templateName: "x",
        templateLanguage: "en_US",
        wabaId: "waba_signup",
      },
      { key },
    );
    const fetchImpl = metaFetch();
    const newPin = vi.fn(() => "123456");

    const outcome = await completeWhatsAppSignup(db, signup(shop.id), config, {
      fetchImpl,
      newPin,
      sender: { key },
    });

    expect(outcome).toBe("waba_already_connected");
    expect(urls(fetchImpl)).toHaveLength(1);
    expect(urls(fetchImpl)[0]).toContain("/oauth/access_token");
    expect(newPin).not.toHaveBeenCalled();
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
  });

  it("skips registration for a number this shop already registered", async () => {
    const { db, shop } = await seededShopContext();
    await completeWhatsAppSignup(db, signup(shop.id), config, {
      fetchImpl: metaFetch(),
      newPin: () => "123456",
      sender: { key },
    });
    const fetchImpl = metaFetch();
    const newPin = vi.fn(() => "654321");

    const outcome = await completeWhatsAppSignup(db, signup(shop.id), config, {
      fetchImpl,
      newPin,
      sender: { key },
    });

    expect(outcome).toBe("connected");
    expect(newPin).not.toHaveBeenCalled();
    expect(urls(fetchImpl).some((url) => url.includes("/register"))).toBe(false);
  });

  it("names the Meta step that failed under the claim, and stores nothing", async () => {
    const { db, shop } = await seededShopContext();
    const fetchImpl = metaFetch();
    fetchImpl.mockImplementationOnce(async () => json(200, { access_token: "EAAG-token" }));
    fetchImpl.mockImplementationOnce(async () =>
      json(400, { error: { message: "PIN mismatch", code: 133005 } }),
    );

    const outcome = await completeWhatsAppSignup(db, signup(shop.id), config, {
      fetchImpl,
      newPin: () => "123456",
      sender: { key },
    });

    expect(outcome).toBe("signup_failed_register");
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
  });
});
