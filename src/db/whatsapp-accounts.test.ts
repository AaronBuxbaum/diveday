// @vitest-environment node

import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { openSecret } from "@/lib/secret-box";
import { seededShopContext } from "@/test/db";
import {
  connectShopWhatsAppAccount,
  disconnectShopWhatsAppAccount,
  getShopWhatsAppAccount,
  markShopWhatsAppVerified,
  shopIdForWhatsAppWaba,
  whatsAppProviderForAccount,
  whatsAppProviderForShop,
  whatsAppProvidersForShops,
} from "./whatsapp-accounts";

const key = randomBytes(32);

function connectInput(shopId: string, overrides: Record<string, unknown> = {}) {
  return {
    shopId,
    phoneNumberId: "1234567890",
    accessToken: "EAAG-shop-access-token",
    templateName: "diveday_courtesy_update",
    templateLanguage: "en_US",
    displayPhoneNumber: "+1 305-555-0100",
    wabaId: "waba_1",
    ...overrides,
  };
}

function okFetch(id = "wamid.OK") {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ messages: [{ id }] }), {
        status: 200,
      }),
  );
}

describe("connectShopWhatsAppAccount", () => {
  it("stores the token sealed, never in plaintext", async () => {
    const { db, shop } = await seededShopContext();
    const result = await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    expect(result.status).toBe("connected");
    const account = await getShopWhatsAppAccount(db, shop.id);
    expect(account?.accessTokenSealed).not.toContain("EAAG-shop-access-token");
    expect(openSecret(account?.accessTokenSealed ?? "", key)).toBe("EAAG-shop-access-token");
  });

  it("refuses to store anything when no encryption key is configured", async () => {
    const { db, shop } = await seededShopContext();
    const result = await connectShopWhatsAppAccount(db, connectInput(shop.id), { key: null });

    expect(result).toEqual({ status: "refused", reason: "encryption_key_unset" });
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
  });

  it("re-connecting rotates the token in place without duplicating the shop's row", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });
    await connectShopWhatsAppAccount(
      db,
      connectInput(shop.id, { accessToken: "EAAG-rotated-token-9999" }),
      { key },
    );

    const account = await getShopWhatsAppAccount(db, shop.id);
    expect(openSecret(account?.accessTokenSealed ?? "", key)).toBe("EAAG-rotated-token-9999");
  });

  it("keeps the original connection date but clears verification on a re-connect", async () => {
    const { db, shop } = await seededShopContext();
    const first = new Date("2026-07-01T00:00:00Z");
    await connectShopWhatsAppAccount(db, connectInput(shop.id, { now: first }), { key });
    await markShopWhatsAppVerified(db, shop.id, new Date("2026-07-02T00:00:00Z"));

    await connectShopWhatsAppAccount(
      db,
      connectInput(shop.id, { accessToken: "EAAG-new", now: new Date("2026-07-10T00:00:00Z") }),
      { key },
    );

    const account = await getShopWhatsAppAccount(db, shop.id);
    expect(account?.connectedAt).toEqual(first);
    // New credentials are unproven until a fresh test send proves them.
    expect(account?.verifiedAt).toBeNull();
  });

  it("preserves the stored registration PIN when a reconnect supplies none", async () => {
    // The bug this guards: a reconnect used to generate a fresh PIN, fail
    // registration with a 133005 mismatch, have that failure swallowed, and
    // then overwrite the column — destroying the only copy of the PIN the
    // number is actually bound to and locking the shop out of re-registering.
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id, { registrationPin: "424242" }), {
      key,
    });
    const first = await getShopWhatsAppAccount(db, shop.id);
    expect(openSecret(first?.registrationPinSealed ?? "", key)).toBe("424242");

    await connectShopWhatsAppAccount(
      db,
      connectInput(shop.id, { accessToken: "EAAG-rotated", registrationPin: null }),
      { key },
    );

    const after = await getShopWhatsAppAccount(db, shop.id);
    expect(openSecret(after?.registrationPinSealed ?? "", key)).toBe("424242");
    expect(openSecret(after?.accessTokenSealed ?? "", key)).toBe("EAAG-rotated");
  });

  it("trims the pasted values a staff form inevitably carries", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(
      db,
      connectInput(shop.id, {
        phoneNumberId: "  1234567890 ",
        templateName: " diveday_courtesy_update ",
        accessToken: "  EAAG-padded-token  ",
      }),
      { key },
    );

    const account = await getShopWhatsAppAccount(db, shop.id);
    expect(account?.phoneNumberId).toBe("1234567890");
    expect(account?.templateName).toBe("diveday_courtesy_update");
    expect(openSecret(account?.accessTokenSealed ?? "", key)).toBe("EAAG-padded-token");
  });
});

describe("disconnectShopWhatsAppAccount", () => {
  it("deletes the row, so no live credential is retained", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    expect(await disconnectShopWhatsAppAccount(db, shop.id)).toBe(true);
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
  });

  it("reports nothing removed for a shop that never connected", async () => {
    const { db, shop } = await seededShopContext();
    expect(await disconnectShopWhatsAppAccount(db, shop.id)).toBe(false);
  });
});

describe("whatsAppProviderForShop", () => {
  it("builds a sender that posts to the shop's own phone number id", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });
    const fetchImpl = okFetch();

    const provider = await whatsAppProviderForShop(db, shop.id, { key, fetchImpl });
    const delivery = await provider?.send({
      to: "+13055551234",
      body: "Reef Runner departs Saturday.",
      shopName: shop.name,
    });

    expect(delivery).toEqual({ status: "sent", providerMessageId: "wamid.OK" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("/1234567890/messages");
    expect(init.headers.Authorization).toBe("Bearer EAAG-shop-access-token");
  });

  it("returns null for a shop that has not connected WhatsApp", async () => {
    const { db, shop } = await seededShopContext();
    expect(await whatsAppProviderForShop(db, shop.id, { key })).toBeNull();
  });

  it("returns null rather than throwing when the key no longer opens the row", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    expect(await whatsAppProviderForShop(db, shop.id, { key: randomBytes(32) })).toBeNull();
  });

  it("returns null when no encryption key is configured at all", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    expect(await whatsAppProviderForShop(db, shop.id, { key: null })).toBeNull();
  });

  it("never hands the caller the plaintext token back", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    const account = await getShopWhatsAppAccount(db, shop.id);
    expect(JSON.stringify(account)).not.toContain("EAAG-shop-access-token");
  });
});

describe("shopIdForWhatsAppWaba", () => {
  it("resolves the WABA a delivery event names to its own shop", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id, { wabaId: "waba_abc" }), { key });

    expect(await shopIdForWhatsAppWaba(db, "waba_abc")).toBe(shop.id);
  });

  it("returns null for a WABA no shop has connected, so nothing is applied unscoped", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id, { wabaId: "waba_abc" }), { key });

    expect(await shopIdForWhatsAppWaba(db, "waba_someone_else")).toBeNull();
  });
});

describe("whatsAppProvidersForShops", () => {
  it("resolves many shops in one pass, omitting those with no connection", async () => {
    const { db, shop } = await seededShopContext();
    const other = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    const senders = await whatsAppProvidersForShops(db, [shop.id, other.shop.id], { key });

    expect([...senders.keys()]).toEqual([shop.id]);
  });

  it("returns an empty map for no shops without querying", async () => {
    const { db } = await seededShopContext();
    expect(await whatsAppProvidersForShops(db, [], { key })).toEqual(new Map());
  });

  it("omits a shop whose sealed token cannot be opened", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    const senders = await whatsAppProvidersForShops(db, [shop.id], { key: randomBytes(32) });
    expect(senders.size).toBe(0);
  });
});

describe("whatsAppProviderForAccount", () => {
  it("sends the shop's stored template name and language", async () => {
    const { db, shop } = await seededShopContext();
    await connectShopWhatsAppAccount(
      db,
      connectInput(shop.id, { templateName: "buceo_aviso", templateLanguage: "es_ES" }),
      { key },
    );
    const account = await getShopWhatsAppAccount(db, shop.id);
    if (!account) throw new Error("account was not stored");
    const fetchImpl = okFetch();

    await whatsAppProviderForAccount(account, { key, fetchImpl })?.send({
      to: "+13055551234",
      body: "Aviso",
      shopName: shop.name,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.template.name).toBe("buceo_aviso");
    expect(body.template.language.code).toBe("es_ES");
  });
});
