import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { shops } from "./schema";
import {
  connectShopWhatsAppAccount,
  getShopWhatsAppAccount,
  getShopWhatsAppRegistration,
  isWhatsAppSetupComplete,
  openRegistrationPin,
  shopIdForWhatsAppWaba,
  whatsAppProviderForAccount,
} from "./whatsapp-accounts";
import { completeWhatsAppSignup } from "./whatsapp-signup";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

const key = randomBytes(32);
const config = { appId: "app-1", appSecret: "app-secret", configId: "config-1" };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

type MetaStep = "exchange" | "waba" | "register" | "subscribe" | "template";

const META_OK: Record<MetaStep, () => Response> = {
  exchange: () => json(200, { access_token: "EAAG-token" }),
  waba: () => json(200, { id: "waba_signup" }),
  register: () => json(200, { success: true }),
  subscribe: () => json(200, { success: true }),
  template: () => json(200, { id: "template-1", status: "PENDING" }),
};

function metaStep(url: string): MetaStep {
  if (url.includes("/oauth/access_token")) return "exchange";
  if (url.includes("/register")) return "register";
  if (url.includes("/subscribed_apps")) return "subscribe";
  if (url.includes("/message_templates")) return "template";
  return "waba";
}

/**
 * Meta answering each call by what it asks for: exchange, the WABA read,
 * register, subscribe, template. `answers` replaces any of them.
 */
function metaFetch(answers: Partial<Record<MetaStep, () => Response>> = {}) {
  return vi.fn().mockImplementation(async (url: unknown) => {
    const step = metaStep(String(url));
    return (answers[step] ?? META_OK[step])();
  });
}

const registerPins = (fetchImpl: ReturnType<typeof metaFetch>) =>
  fetchImpl.mock.calls
    .filter((call: unknown[]) => String(call[0]).includes("/register"))
    .map((call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)).pin);

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
    const { db, shop } = ctx;
    const fetchImpl = metaFetch();
    const newPin = vi.fn(() => "123456");

    const outcome = await completeWhatsAppSignup(db, signup(shop.id), config, {
      fetchImpl,
      newPin,
      sender: { key },
    });

    expect(outcome).toBe("connected");
    expect(newPin).toHaveBeenCalledTimes(1);
    expect(urls(fetchImpl)[1]).toContain("/waba_signup?fields=id");
    expect(urls(fetchImpl)[2]).toContain("/register");
    expect(await shopIdForWhatsAppWaba(db, "waba_signup")).toBe(shop.id);
  });

  /**
   * **A junk code learns nothing about other shops** (issue #1766). The WABA
   * check runs only after Meta has accepted the code, so a post naming a WABA
   * another DiveDay shop holds, with ten junk characters for a code, reads the
   * same refusal as one naming a WABA nobody holds.
   */
  it("refuses a bad code before asking who holds the WABA", async () => {
    const { db, shop } = ctx;
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
    const fetchImpl = metaFetch({
      exchange: () => json(400, { error: { message: "Invalid code", code: 100 } }),
    });
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
    const { db, shop } = ctx;
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
    expect(urls(fetchImpl)).toHaveLength(2);
    expect(urls(fetchImpl).some((url) => url.includes("/register"))).toBe(false);
    expect(newPin).not.toHaveBeenCalled();
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
  });

  it("skips registration for a number this shop already registered", async () => {
    const { db, shop } = ctx;
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

  it("names the Meta step that failed under the claim, and stores nothing Meta refused", async () => {
    const { db, shop } = ctx;
    const fetchImpl = metaFetch({
      register: () => json(400, { error: { message: "PIN mismatch", code: 133005 } }),
    });

    const outcome = await completeWhatsAppSignup(db, signup(shop.id), config, {
      fetchImpl,
      newPin: () => "123456",
      sender: { key },
    });

    expect(outcome).toBe("signup_failed_register");
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
    expect(await getShopWhatsAppRegistration(db, shop.id)).toBeNull();
  });

  /**
   * **A token that cannot see the posted WABA learns nothing** (issue #1766,
   * security re-review). A staffer with a valid code for their own account who
   * posts another shop's WABA id is refused exactly as a junk code is — before
   * the holder check, and with no PIN minted.
   */
  it("refuses a WABA the exchanged token cannot read, the same way as a bad code", async () => {
    const { db, shop } = ctx;
    const sibling = await siblingShop(db, "sibling-signup-invisible");
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
    const newPin = vi.fn(() => "123456");

    for (const waba of [
      () =>
        json(403, { error: { message: "Unsupported get request", code: 100, error_subcode: 33 } }),
      () => json(200, { id: "some_other_waba" }),
    ]) {
      const fetchImpl = metaFetch({ waba });
      const outcome = await completeWhatsAppSignup(db, signup(shop.id), config, {
        fetchImpl,
        newPin,
        sender: { key },
      });
      expect(outcome).toBe("signup_failed_exchange");
      expect(urls(fetchImpl)).toHaveLength(2);
      const wabaRead = fetchImpl.mock.calls[1] as unknown[];
      expect((wabaRead[1] as RequestInit).headers).toMatchObject({
        Authorization: "Bearer EAAG-token",
      });
    }
    expect(newPin).not.toHaveBeenCalled();
    expect(await getShopWhatsAppRegistration(db, shop.id)).toBeNull();
  });

  /**
   * **A PIN sent to Meta is kept even when a later step fails** (issue #1769,
   * security re-review). Register succeeds, subscribe fails: the number is now
   * bound to that PIN at Meta, so the row is parked with it — not connected,
   * no sender — and the next Connect registers with the stored PIN rather than
   * minting one Meta would refuse with 133005.
   */
  it("parks the PIN when subscribe fails, and the next Connect reuses it", async () => {
    const { db, shop } = ctx;
    const firstPin = vi.fn(() => "123456");
    const failing = metaFetch({ subscribe: () => json(500, { error: { code: 2 } }) });

    expect(
      await completeWhatsAppSignup(db, signup(shop.id), config, {
        fetchImpl: failing,
        newPin: firstPin,
        sender: { key },
      }),
    ).toBe("signup_failed_subscribe");
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
    const parked = await getShopWhatsAppRegistration(db, shop.id);
    expect(parked && isWhatsAppSetupComplete(parked)).toBe(false);
    expect(parked?.verifiedAt).toBeNull();
    expect(parked && whatsAppProviderForAccount(parked, { key })).toBeNull();
    expect(await shopIdForWhatsAppWaba(db, "waba_signup")).toBe(shop.id);

    const retry = metaFetch();
    const secondPin = vi.fn(() => "654321");
    expect(
      await completeWhatsAppSignup(db, signup(shop.id), config, {
        fetchImpl: retry,
        newPin: secondPin,
        sender: { key },
      }),
    ).toBe("connected");
    expect(secondPin).not.toHaveBeenCalled();
    expect(registerPins(retry)).toEqual(["123456"]);
    const connected = await getShopWhatsAppAccount(db, shop.id);
    expect(connected?.templateName).toBe("diveday_courtesy_update");
    expect(connected && openRegistrationPin(connected, { key })).toBe("123456");
  });

  /**
   * A register that timed out on DiveDay's side may still have completed at
   * Meta, so its PIN is parked as well; one Meta answered with an error bound
   * nothing (the test above), and stores nothing.
   */
  it("parks the PIN when register times out", async () => {
    const { db, shop } = ctx;
    const fetchImpl = metaFetch({
      register: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });

    expect(
      await completeWhatsAppSignup(db, signup(shop.id), config, {
        fetchImpl,
        newPin: () => "123456",
        sender: { key },
      }),
    ).toBe("signup_failed_register");
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
    const parked = await getShopWhatsAppRegistration(db, shop.id);
    expect(parked && openRegistrationPin(parked, { key })).toBe("123456");
  });
});
