import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { openSecret } from "@/lib/secret-box";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import type { AppDb, DbExecutor } from "./client";
import { shops } from "./schema";
import {
  claimWhatsAppNumber,
  connectShopWhatsAppAccount,
  disconnectShopWhatsAppAccount,
  getShopWhatsAppAccount,
  getShopWhatsAppRegistration,
  markShopWhatsAppVerified,
  PARKED_REGISTRATION_STALE_MS,
  SETUP_INCOMPLETE_TEMPLATE,
  shopIdForWhatsAppEvent,
  shopPublicWhatsAppNumber,
  whatsAppAccountForPhoneNumber,
  whatsAppProviderForAccount,
  whatsAppProvidersForShops,
} from "./whatsapp-accounts";

const key = randomBytes(32);
afterEach(() => vi.unstubAllEnvs());

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

/** A second tenant in the same database — the whole point of every WABA test below. */
async function siblingShop(db: AppDb, slug: string) {
  const [sibling] = await db
    .insert(shops)
    .values({ name: "Sibling Shop", slug, timezone: "UTC" })
    .returning();
  if (!sibling) throw new Error("second shop insert failed");
  return sibling;
}

function okFetch(id = "wamid.OK") {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ messages: [{ id }] }), {
        status: 200,
      }),
  );
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("connectShopWhatsAppAccount", () => {
  it("prefers an injected key over malformed environment configuration", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "invalid");
    const { db, shop } = ctx;
    expect(await connectShopWhatsAppAccount(db, connectInput(shop.id), { key })).toMatchObject({
      status: "connected",
    });
  });

  it("maps a malformed environment key to the existing refusal code", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "invalid");
    const { db, shop } = ctx;
    expect(await connectShopWhatsAppAccount(db, connectInput(shop.id))).toEqual({
      status: "refused",
      reason: "encryption_key_invalid",
    });
  });

  it("stores the token sealed, never in plaintext", async () => {
    const { db, shop } = ctx;
    const result = await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    expect(result.status).toBe("connected");
    const account = await getShopWhatsAppAccount(db, shop.id);
    expect(account?.accessTokenSealed).not.toContain("EAAG-shop-access-token");
    expect(openSecret(account?.accessTokenSealed ?? "", key)).toBe("EAAG-shop-access-token");
  });

  it("refuses to store anything when no encryption key is configured", async () => {
    const { db, shop } = ctx;
    const result = await connectShopWhatsAppAccount(db, connectInput(shop.id), { key: null });

    expect(result).toEqual({ status: "refused", reason: "encryption_key_unset" });
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
  });

  it("re-connecting rotates the token in place without duplicating the shop's row", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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

  it("refuses a phone number another shop already holds, and stores nothing", async () => {
    // The number is the tenant key every inbound WhatsApp event is routed on
    // (H-83), and two rows holding one would make a diver's message — a reply
    // keyword in it up to a cancellation — land in an arbitrary one of them.
    const { db, shop } = ctx;
    const sibling = await siblingShop(db, "sibling-shop-number-taken");
    await connectShopWhatsAppAccount(db, connectInput(shop.id, { phoneNumberId: "555" }), { key });

    const result = await connectShopWhatsAppAccount(
      db,
      connectInput(sibling.id, { phoneNumberId: "555", wabaId: "waba_other" }),
      { key },
    );

    expect(result).toEqual({ status: "refused", reason: "phone_number_already_connected" });
    // Rejected by the database, not merely absent: a test that only re-read the
    // first shop's row would still pass with the unique index dropped.
    expect(await getShopWhatsAppAccount(db, sibling.id)).toBeNull();
    expect(await shopIdForWhatsAppEvent(db, { phoneNumberId: "555", wabaId: null })).toBe(shop.id);
  });

  it("lets a chain connect two shops under one WABA, a number each (H-83)", async () => {
    const { db, shop } = ctx;
    const sibling = await siblingShop(db, "sibling-shop-chain");
    const chain = { wabaId: "waba_chain" };
    expect(
      (
        await connectShopWhatsAppAccount(
          db,
          connectInput(shop.id, { ...chain, phoneNumberId: "111" }),
          { key },
        )
      ).status,
    ).toBe("connected");
    expect(
      (
        await connectShopWhatsAppAccount(
          db,
          connectInput(sibling.id, { ...chain, phoneNumberId: "222" }),
          { key },
        )
      ).status,
    ).toBe("connected");
  });

  it("refuses a held number inside a transaction without breaking the transaction", async () => {
    // The signup completes under `claimWhatsAppNumber`'s transaction (#1769). A
    // 23505 there aborts the whole transaction unless the insert ran in a
    // savepoint, and the refusal would surface as "current transaction is
    // aborted" instead of the worded `phone_number_already_connected`.
    const { db, shop } = ctx;
    const sibling = await siblingShop(db, "sibling-shop-number-tx");
    await connectShopWhatsAppAccount(db, connectInput(shop.id, { phoneNumberId: "777" }), { key });

    const afterwards = await db.transaction(async (tx) => {
      const result = await connectShopWhatsAppAccount(
        tx,
        connectInput(sibling.id, { phoneNumberId: "777" }),
        { key },
      );
      expect(result).toEqual({ status: "refused", reason: "phone_number_already_connected" });
      return shopIdForWhatsAppEvent(tx, { phoneNumberId: "777", wabaId: null });
    });
    expect(afterwards).toBe(shop.id);
  });

  it("lets two shops connect before a WABA is recorded, because nulls repeat", async () => {
    // `waba_id` stays nullable on purpose: a shop whose row predates a
    // recorded WABA is legal, and two of them are too.
    const { db, shop } = ctx;
    const sibling = await siblingShop(db, "sibling-shop-waba-null");

    expect(
      (await connectShopWhatsAppAccount(db, connectInput(shop.id, { wabaId: null }), { key }))
        .status,
    ).toBe("connected");
    expect(
      (
        await connectShopWhatsAppAccount(
          db,
          connectInput(sibling.id, { wabaId: null, phoneNumberId: "9876543210" }),
          { key },
        )
      ).status,
    ).toBe("connected");
    expect((await getShopWhatsAppAccount(db, sibling.id))?.wabaId).toBeNull();
  });

  it("trims the pasted values a staff form inevitably carries", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    expect(await disconnectShopWhatsAppAccount(db, shop.id)).toBe(true);
    expect(await getShopWhatsAppAccount(db, shop.id)).toBeNull();
  });

  it("reports nothing removed for a shop that never connected", async () => {
    const { db, shop } = ctx;
    expect(await disconnectShopWhatsAppAccount(db, shop.id)).toBe(false);
  });
});

describe("getShopWhatsAppAccount", () => {
  it("never hands the caller the plaintext token back", async () => {
    const { db, shop } = ctx;
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    const account = await getShopWhatsAppAccount(db, shop.id);
    expect(JSON.stringify(account)).not.toContain("EAAG-shop-access-token");
  });
});

/**
 * **Whose event is this** (H-83, issue #1767): two shops of one chain share a
 * WABA, and each receives only what was sent to its own number.
 */
describe("shopIdForWhatsAppEvent", () => {
  async function chain() {
    const { db, shop } = ctx;
    const sibling = await siblingShop(db, `sibling-chain-${randomBytes(3).toString("hex")}`);
    await connectShopWhatsAppAccount(
      db,
      connectInput(shop.id, { wabaId: "waba_chain", phoneNumberId: "111" }),
      { key },
    );
    await connectShopWhatsAppAccount(
      db,
      connectInput(sibling.id, { wabaId: "waba_chain", phoneNumberId: "222" }),
      { key },
    );
    return { db, north: shop.id, south: sibling.id };
  }

  it("routes each number on a shared WABA to its own shop", async () => {
    const { db, north, south } = await chain();
    expect(await shopIdForWhatsAppEvent(db, { phoneNumberId: "111", wabaId: "waba_chain" })).toBe(
      north,
    );
    expect(await shopIdForWhatsAppEvent(db, { phoneNumberId: "222", wabaId: "waba_chain" })).toBe(
      south,
    );
  });

  it("never falls back to the WABA for a number nobody here holds", async () => {
    const { db } = ctx;
    await connectShopWhatsAppAccount(
      db,
      connectInput(ctx.shop.id, { wabaId: "waba_alone", phoneNumberId: "111" }),
      { key },
    );
    expect(
      await shopIdForWhatsAppEvent(db, { phoneNumberId: "999", wabaId: "waba_alone" }),
    ).toBeNull();
  });

  it("does not place an event whose WABA disagrees with its number's row", async () => {
    const { db } = await chain();
    expect(
      await shopIdForWhatsAppEvent(db, { phoneNumberId: "111", wabaId: "waba_elsewhere" }),
    ).toBeNull();
  });

  it("drops an event that names no number, even on a WABA one shop alone holds", async () => {
    const { db } = ctx;
    await connectShopWhatsAppAccount(
      db,
      connectInput(ctx.shop.id, { wabaId: "waba_alone", phoneNumberId: "111" }),
      { key },
    );
    expect(
      await shopIdForWhatsAppEvent(db, { phoneNumberId: null, wabaId: "waba_alone" }),
    ).toBeNull();
  });

  it("does not place an event naming a WABA when its number's row records none", async () => {
    const { db } = ctx;
    await connectShopWhatsAppAccount(
      db,
      connectInput(ctx.shop.id, { wabaId: null, phoneNumberId: "111" }),
      { key },
    );
    expect(
      await shopIdForWhatsAppEvent(db, { phoneNumberId: "111", wabaId: "waba_anyone" }),
    ).toBeNull();
    // An event that names no WABA still routes on the number alone.
    expect(await shopIdForWhatsAppEvent(db, { phoneNumberId: "111", wabaId: null })).toBe(
      ctx.shop.id,
    );
  });

  it("drops an event that names no number on a shared WABA, or names nothing", async () => {
    const { db } = await chain();
    expect(
      await shopIdForWhatsAppEvent(db, { phoneNumberId: null, wabaId: "waba_chain" }),
    ).toBeNull();
    expect(await shopIdForWhatsAppEvent(db, { phoneNumberId: null, wabaId: null })).toBeNull();
  });
});

/**
 * **One Connect per number at a time** (issues #1769 and #1767, H-83).
 * Registering a number at Meta mints a PIN, and a row refused after that
 * leaves the number bound to a PIN nobody holds; recovery runs through Meta
 * support. So the pre-check, the Meta calls and the insert all run under locks
 * on the shop, the WABA and the number, and a second shop's Connect for a
 * number already held refuses without registering.
 */
describe("claimWhatsAppNumber", () => {
  // Databases of their own, not the file's shared transaction: the subject is
  // a transaction-scoped lock and two callers racing for it. Inside one
  // wrapping transaction the callers share a connection and cannot contend,
  // and the lock outlives the claim that took it (src/test/db.ts, "When NOT to use this").
  /** One number on one WABA: what every claim below races for. */
  const RACE = { wabaId: "waba_race", phoneNumberId: "1234567890" };

  /** A stand-in for the Meta round trip: records the register, then stores the row. */
  function signupWork(shopId: string, registered: string[]) {
    return async (tx: DbExecutor) => {
      registered.push(shopId);
      // A tick, so the two callers genuinely interleave on an unlocked path.
      await new Promise((resolve) => setTimeout(resolve, 10));
      return connectShopWhatsAppAccount(tx, connectInput(shopId, { wabaId: "waba_race" }), {
        key,
      });
    };
  }

  it("lets one of two shops connecting the same number at once register, and refuses the other first", async () => {
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-shop-waba-race");
    const registered: string[] = [];

    const outcomes = await Promise.all(
      [shop.id, sibling.id].map((shopId) =>
        claimWhatsAppNumber(db, { shopId, ...RACE }, signupWork(shopId, registered)),
      ),
    );

    // The assertion that fails without the lock: both callers pass an
    // unlocked pre-check and both register a number at Meta.
    expect(registered).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "held_elsewhere")).toHaveLength(1);
    const winner = outcomes.find((outcome) => outcome.status === "claimed");
    expect(winner?.status === "claimed" && winner.value.status).toBe("connected");
    expect((await whatsAppAccountForPhoneNumber(db, RACE.phoneNumberId))?.shopId ?? null).toBe(
      registered[0],
    );
  });

  it("lets a second shop of a chain claim its own number on the same WABA", async () => {
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-shop-chain-claim");
    await claimWhatsAppNumber(db, { shopId: shop.id, ...RACE }, signupWork(shop.id, []));
    const second = await claimWhatsAppNumber(
      db,
      { shopId: sibling.id, wabaId: RACE.wabaId, phoneNumberId: "2222222222" },
      (tx: DbExecutor) =>
        connectShopWhatsAppAccount(
          tx,
          connectInput(sibling.id, { wabaId: RACE.wabaId, phoneNumberId: "2222222222" }),
          { key },
        ),
    );
    expect(second.status === "claimed" && second.value.status).toBe("connected");
  });

  it("lets the shop that holds the number reconnect", async () => {
    const { db, shop } = await seededShopContext();
    const registered: string[] = [];
    await claimWhatsAppNumber(db, { shopId: shop.id, ...RACE }, signupWork(shop.id, registered));
    const again = await claimWhatsAppNumber(
      db,
      { shopId: shop.id, ...RACE },
      signupWork(shop.id, registered),
    );
    expect(again.status).toBe("claimed");
    expect(registered).toEqual([shop.id, shop.id]);
  });

  // Issue #2194: a Connect abandoned after Meta's register call leaves a parked
  // row nobody can see, and it must not hold the number against another shop forever.
  async function parkedAt(db: AppDb, shopId: string, ageMs: number) {
    const parked = await connectShopWhatsAppAccount(
      db,
      {
        ...connectInput(shopId, { wabaId: "waba_race" }),
        templateName: SETUP_INCOMPLETE_TEMPLATE,
        registrationPin: "123456",
        now: new Date(nowDate().getTime() - ageMs),
      },
      { key },
    );
    if (parked.status !== "connected") throw new Error("parked row not stored");
  }

  it("lets another shop claim a number held only by a stale parked row", async () => {
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-shop-stale-park");
    await parkedAt(db, sibling.id, PARKED_REGISTRATION_STALE_MS + 60_000);

    const registered: string[] = [];
    const claim = await claimWhatsAppNumber(
      db,
      { shopId: shop.id, ...RACE },
      signupWork(shop.id, registered),
    );
    expect(claim.status).toBe("claimed");
    expect(registered).toEqual([shop.id]);
    expect((await whatsAppAccountForPhoneNumber(db, RACE.phoneNumberId))?.shopId ?? null).toBe(
      shop.id,
    );
    expect(await getShopWhatsAppRegistration(db, sibling.id)).toBeNull();
  });

  it("still refuses another shop while a parked row is fresh", async () => {
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-shop-fresh-park");
    await parkedAt(db, sibling.id, PARKED_REGISTRATION_STALE_MS - 60_000);

    const registered: string[] = [];
    const claim = await claimWhatsAppNumber(
      db,
      { shopId: shop.id, ...RACE },
      signupWork(shop.id, registered),
    );
    expect(claim.status).toBe("held_elsewhere");
    expect(registered).toEqual([]);
    expect(await getShopWhatsAppRegistration(db, sibling.id)).not.toBeNull();
  });

  it("never releases a connected row, however old", async () => {
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-shop-old-connected");
    await connectShopWhatsAppAccount(
      db,
      {
        ...connectInput(sibling.id, { wabaId: "waba_race" }),
        now: new Date(nowDate().getTime() - 10 * PARKED_REGISTRATION_STALE_MS),
      },
      { key },
    );

    const claim = await claimWhatsAppNumber(
      db,
      { shopId: shop.id, ...RACE },
      signupWork(shop.id, []),
    );
    expect(claim.status).toBe("held_elsewhere");
  });

  it("leaves no row and no lock behind when the work throws", async () => {
    // A crashed request must not strand the WABA: the lock is the
    // transaction's own, so it ends with it, and nothing was reserved.
    const { db, shop } = await seededShopContext();
    const sibling = await siblingShop(db, "sibling-shop-waba-crash");
    await expect(
      claimWhatsAppNumber(db, { shopId: shop.id, ...RACE }, async () => {
        throw new Error("Meta went away");
      }),
    ).rejects.toThrow("Meta went away");
    expect(
      (await whatsAppAccountForPhoneNumber(db, RACE.phoneNumberId))?.shopId ?? null,
    ).toBeNull();

    const registered: string[] = [];
    const next = await claimWhatsAppNumber(
      db,
      { shopId: sibling.id, ...RACE },
      signupWork(sibling.id, registered),
    );
    expect(next.status).toBe("claimed");
  });
});

describe("whatsAppProvidersForShops", () => {
  it("builds a sender that posts to the shop's own phone number id", async () => {
    const { db, shop } = ctx;
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });
    const fetchImpl = okFetch();

    const senders = await whatsAppProvidersForShops(db, [shop.id], { key, fetchImpl });
    const delivery = await senders.get(shop.id)?.send({
      to: "+13055551234",
      body: "Reef Runner departs Saturday.",
      shopName: shop.name,
    });

    expect(delivery).toEqual({ status: "sent", providerMessageId: "wamid.OK" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("/1234567890/messages");
    expect(init.headers.Authorization).toBe("Bearer EAAG-shop-access-token");
  });

  it("omits a shop when no encryption key is configured at all", async () => {
    const { db, shop } = ctx;
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    expect((await whatsAppProvidersForShops(db, [shop.id], { key: null })).size).toBe(0);
  });

  it("resolves many shops in one pass, omitting those with no connection", async () => {
    const { db, shop } = ctx;
    const other = await siblingShop(db, "sibling-shop-no-whatsapp");
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    const senders = await whatsAppProvidersForShops(db, [shop.id, other.id], { key });

    expect([...senders.keys()]).toEqual([shop.id]);
  });

  it("returns an empty map for no shops without querying", async () => {
    const { db } = ctx;
    expect(await whatsAppProvidersForShops(db, [], { key })).toEqual(new Map());
  });

  it("omits a shop whose sealed token cannot be opened", async () => {
    const { db, shop } = ctx;
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });

    const senders = await whatsAppProvidersForShops(db, [shop.id], { key: randomBytes(32) });
    expect(senders.size).toBe(0);
  });
});

describe("whatsAppProviderForAccount", () => {
  it("sends the shop's stored template name and language", async () => {
    const { db, shop } = ctx;
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

describe("shopPublicWhatsAppNumber", () => {
  it("gives the public footer the printed number of a finished signup, and nothing else", async () => {
    const { db, shop } = ctx;
    expect(await shopPublicWhatsAppNumber(db, shop.id)).toBeNull();
    await connectShopWhatsAppAccount(db, connectInput(shop.id), { key });
    expect(await shopPublicWhatsAppNumber(db, shop.id)).toBe("+1 305-555-0100");
  });

  it("gives nothing for a row parked mid-signup, or for another shop's sender", async () => {
    const { db, shop } = ctx;
    await connectShopWhatsAppAccount(
      db,
      connectInput(shop.id, { templateName: SETUP_INCOMPLETE_TEMPLATE }),
      { key },
    );
    expect(await shopPublicWhatsAppNumber(db, shop.id)).toBeNull();

    const sibling = await siblingShop(db, "public-number-sibling");
    expect(await shopPublicWhatsAppNumber(db, sibling.id)).toBeNull();
  });
});
