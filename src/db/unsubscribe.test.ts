import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { fileScopedShopContext } from "@/test/db";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { askAnytime, issueInterestUnsubscribeToken } from "./interests";
import { findOrCreatePerson } from "./people";
import { interests, people, shops, userAccounts } from "./schema";
import { setShopShoreAlertContact } from "./shops";
import { issueShoreAlertStopToken } from "./shore-alert-tokens";
import { listStaff } from "./trips";
import { resolveUnsubscribeToken, unsubscribeByToken } from "./unsubscribe";
import { issueWeeklyDigestUnsubscribeToken } from "./weekly-digest";

/**
 * Issue #3659, security-sensitive (bearer tokens): one resolver for the five
 * kinds of unsubscribe link. A real database, a rolled-back transaction per
 * test. The adversarial rows are the point: a token names one kind and only
 * that kind's state moves; a guess, a stored hash or a spent link moves nothing.
 */
const ctx = fileScopedShopContext();
const at = new Date("2026-10-15T12:00:00.000Z");
const SHORE = "shore@example.com";
const BOOKS = "books@example.com";

async function fixture() {
  const { db, shop } = ctx;
  const { person } = await findOrCreatePerson(db, {
    shopId: shop.id,
    fullName: "Nora Quinn",
    email: "nora-unsub@example.com",
    origin: "counter",
  });
  const joined = await askAnytime(db, {
    shopId: shop.id,
    fullName: "Ines Mora",
    email: "ines-unsub@example.com",
  } as never);
  const interestToken = await issueInterestUnsubscribeToken(db, {
    shopId: shop.id,
    interestId: joined.interestId,
  });
  const courtesyToken = await issuePersonCourtesyEmailUnsubscribeToken(db, {
    shopId: shop.id,
    personId: person.id,
  });

  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("fixture staff missing");
  const digestToken = await issueWeeklyDigestUnsubscribeToken(db, {
    shopId: shop.id,
    personId: staff.person.id,
  });
  await db
    .update(userAccounts)
    .set({ weeklyDigest: true })
    .where(eq(userAccounts.personId, staff.person.id));

  await setShopShoreAlertContact(db, shop.id, {
    email: SHORE,
    consentAt: at,
    consentByPersonId: staff.person.id,
    confirmedAt: at,
  });
  const shoreToken = await issueShoreAlertStopToken(db, { shopId: shop.id, email: SHORE });

  const bookkeeperToken = createBearerToken();
  await db
    .update(shops)
    .set({
      bookkeeperEmail: BOOKS,
      bookkeeperEmailSetAt: at,
      bookkeeperEmailSetByPersonId: staff.person.id,
      bookkeeperStopTokenHash: hashBearerToken(bookkeeperToken),
    })
    .where(eq(shops.id, shop.id));

  /** Every piece of state any of the five kinds can move. */
  async function state() {
    const [interest] = await db
      .select({ closedAt: interests.closedAt })
      .from(interests)
      .where(eq(interests.id, joined.interestId));
    const [courtesy] = await db
      .select({ at: people.courtesyEmailOptOutAt })
      .from(people)
      .where(eq(people.id, person.id));
    const [digest] = await db
      .select({ on: userAccounts.weeklyDigest })
      .from(userAccounts)
      .where(eq(userAccounts.personId, staff.person.id));
    const [row] = await db
      .select({ shore: shops.shoreAlertEmail, books: shops.bookkeeperEmail })
      .from(shops)
      .where(eq(shops.id, shop.id));
    return {
      interestClosed: interest?.closedAt != null,
      courtesyOptedOut: courtesy?.at != null,
      digestOn: digest?.on,
      shore: row?.shore ?? null,
      books: row?.books ?? null,
    };
  }

  return {
    db,
    shop,
    state,
    tokens: {
      interest: interestToken,
      courtesy: courtesyToken,
      weeklyDigest: digestToken,
      shoreAlert: shoreToken,
      bookkeeper: bookkeeperToken,
    },
  };
}

const UNTOUCHED = {
  interestClosed: false,
  courtesyOptedOut: false,
  digestOn: true,
  shore: SHORE,
  books: BOOKS,
};

describe("the one unsubscribe resolver", () => {
  it("names the kind of each of the five tokens and says none is done yet", async () => {
    const { db, shop, tokens } = await fixture();
    for (const [kind, token] of Object.entries(tokens)) {
      expect(await resolveUnsubscribeToken(db, token)).toEqual({
        kind,
        shopName: shop.name,
        done: false,
      });
    }
  });

  it("resolving never writes", async () => {
    const { db, tokens, state } = await fixture();
    for (const token of Object.values(tokens)) await resolveUnsubscribeToken(db, token);
    expect(await state()).toEqual(UNTOUCHED);
  });

  it.each([
    ["interest", { interestClosed: true }],
    ["courtesy", { courtesyOptedOut: true }],
    ["weeklyDigest", { digestOn: false }],
    ["shoreAlert", { shore: null }],
    ["bookkeeper", { books: null }],
  ] as const)("applying a %s token moves that kind's state and no other", async (kind, moved) => {
    const { db, tokens, state } = await fixture();

    const result = await unsubscribeByToken(db, { token: tokens[kind], now: at });

    expect(result).toMatchObject({ kind, done: false });
    expect(await state()).toEqual({ ...UNTOUCHED, ...moved });
    expect(await resolveUnsubscribeToken(db, tokens[kind])).toMatchObject({ kind, done: true });
  });

  it("is idempotent: a second apply reads as done and changes nothing more", async () => {
    const { db, tokens, state } = await fixture();
    await unsubscribeByToken(db, { token: tokens.courtesy, now: at });
    const after = await state();

    expect(await unsubscribeByToken(db, { token: tokens.courtesy, now: at })).toMatchObject({
      kind: "courtesy",
      done: true,
    });
    expect(await state()).toEqual(after);
  });

  it("a spent shore-alert link stays done and cannot take a re-added contact off again", async () => {
    const { db, shop, tokens, state } = await fixture();
    await unsubscribeByToken(db, { token: tokens.shoreAlert, now: at });
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("fixture staff missing");
    await setShopShoreAlertContact(db, shop.id, {
      email: SHORE,
      consentAt: at,
      consentByPersonId: staff.person.id,
      confirmedAt: at,
    });

    expect(await unsubscribeByToken(db, { token: tokens.shoreAlert, now: at })).toMatchObject({
      kind: "shoreAlert",
      done: true,
    });
    expect((await state()).shore).toBe(SHORE);
  });

  describe("adversarial", () => {
    it.each([
      ["empty", ""],
      ["unknown", "not-a-real-token"],
      ["whitespace", "   "],
      ["sql-shaped", "' OR '1'='1"],
      ["a very long guess", "x".repeat(10_000)],
    ])("a %s token resolves to nothing and moves nothing", async (_name, guess) => {
      const { db, state } = await fixture();

      expect(await resolveUnsubscribeToken(db, guess)).toBeNull();
      expect(await unsubscribeByToken(db, { token: guess, now: at })).toBeNull();
      expect(await state()).toEqual(UNTOUCHED);
    });

    it("a stored hash is not a token: presenting any table's hash moves nothing", async () => {
      const { db, tokens, state } = await fixture();
      for (const token of Object.values(tokens)) {
        const hash = hashBearerToken(token);
        expect(await resolveUnsubscribeToken(db, hash)).toBeNull();
        expect(await unsubscribeByToken(db, { token: hash, now: at })).toBeNull();
      }
      expect(await state()).toEqual(UNTOUCHED);
    });

    it("a token altered by case or padding is a different token", async () => {
      const { db, tokens, state } = await fixture();
      for (const token of Object.values(tokens)) {
        for (const altered of [token.toUpperCase(), ` ${token}`, `${token} `, token.slice(1)]) {
          if (altered === token) continue;
          expect(await unsubscribeByToken(db, { token: altered, now: at })).toBeNull();
        }
      }
      expect(await state()).toEqual(UNTOUCHED);
    });

    it("an account-level token of another purpose does not unsubscribe anything", async () => {
      const { db, state } = await fixture();
      // A fresh random capability that no unsubscribe table holds.
      const stranger = createBearerToken();
      expect(await unsubscribeByToken(db, { token: stranger, now: at })).toBeNull();
      expect(await state()).toEqual(UNTOUCHED);
    });

    it("a deleted person's Monday-email link reads as unavailable and leaves the account on", async () => {
      const { db, shop, tokens, state } = await fixture();
      const [staff] = await listStaff(db, shop.id);
      if (!staff) throw new Error("fixture staff missing");
      await db.update(people).set({ deletedAt: at }).where(eq(people.id, staff.person.id));

      expect(await resolveUnsubscribeToken(db, tokens.weeklyDigest)).toBeNull();
      expect(await unsubscribeByToken(db, { token: tokens.weeklyDigest, now: at })).toBeNull();
      expect((await state()).digestOn).toBe(true);
    });

    it("a replaced bookkeeper link is dead: only the newest stop token works", async () => {
      const { db, shop, tokens, state } = await fixture();
      const newer = createBearerToken();
      await db
        .update(shops)
        .set({ bookkeeperStopTokenHash: hashBearerToken(newer) })
        .where(eq(shops.id, shop.id));

      expect(await unsubscribeByToken(db, { token: tokens.bookkeeper, now: at })).toBeNull();
      expect((await state()).books).toBe(BOOKS);
      expect(await unsubscribeByToken(db, { token: newer, now: at })).toMatchObject({
        kind: "bookkeeper",
      });
      expect((await state()).books).toBeNull();
    });
  });
});
