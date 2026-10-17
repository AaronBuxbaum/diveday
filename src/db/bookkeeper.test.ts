import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import {
  bookkeeperNoticeRecipients,
  checkBookkeeperConfirmation,
  claimBookkeeperMonth,
  consumeBookkeeperConfirmation,
  isBookkeeperToken,
  issueBookkeeperConfirmation,
  listBookkeeperShops,
  readBookkeeper,
  releaseBookkeeperMonth,
  resolveBookkeeperStopToken,
  setBookkeeper,
  stopBookkeeperByToken,
  wasBookkeeperConfirmed,
} from "./bookkeeper";
import type { AppDb } from "./client";
import { activityEvents, people, personRoles, shops, userAccounts } from "./schema";

/**
 * The bookkeeper's address, its confirmation and the month-end claim (fifth
 * loop, item 35; security review B1), over an unseeded database so every shop
 * is the test's own.
 */

const TZ = "America/New_York";
const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OCT_20 = new Date("2026-10-20T15:00:00Z");
const BOOKS = "books@example.com";

async function shopRow(db: AppDb, slug: string, values: Partial<typeof shops.$inferInsert> = {}) {
  const [row] = await db
    .insert(shops)
    .values({ name: slug, slug, timezone: TZ, ...values })
    .returning();
  if (!row) throw new Error("shop insert failed");
  return row.id;
}

const rowOf = async (db: AppDb, shopId: string) =>
  (await db.select().from(shops).where(eq(shops.id, shopId)))[0];

const set = (db: AppDb, shopId: string, email: string | null, personId = PERSON, now = OCT_20) =>
  setBookkeeper(db, { shopId, timeZone: TZ, email, personId, now });

/** Sets the address and confirms it through its link. */
async function confirmed(db: AppDb, shopId: string, email = BOOKS, now = OCT_20) {
  await set(db, shopId, email);
  const issued = await issueBookkeeperConfirmation(db, { shopId, email, now });
  if (!issued) throw new Error("no link");
  await consumeBookkeeperConfirmation(db, { token: issued.token, now, origin: null });
  return issued.token;
}

/** A claim for the address on file, set by `PERSON`: the stop token, or null when lost. */
const claim = (db: AppDb, shopId: string, month: string, over: { email?: string } = {}) =>
  claimBookkeeperMonth(db, {
    shopId,
    email: over.email ?? BOOKS,
    setByPersonId: PERSON,
    month,
  });

/** A staff member with a login, holding `role`, in `shopId`. */
async function staffer(
  db: AppDb,
  shopId: string,
  input: { name: string; email: string; role: "owner" | "manager"; status?: "active" | "disabled" },
) {
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: input.name, email: input.email })
    .returning();
  if (!person) throw new Error("person insert failed");
  await db.insert(personRoles).values({ personId: person.id, role: input.role });
  await db
    .insert(userAccounts)
    .values({ personId: person.id, email: input.email, status: input.status ?? "active" });
  return person.id;
}

describe("setBookkeeper", () => {
  it("keeps who set the address and when, unconfirmed, and counts the month due as sent", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-set");
    expect(await set(db, shopId, BOOKS)).toEqual({ change: "set", confirmed: false });
    expect(await readBookkeeper(db, shopId)).toMatchObject({
      email: BOOKS,
      setAt: OCT_20,
      setByPersonId: PERSON,
      confirmedAt: null,
    });
    expect((await rowOf(db, shopId))?.bookkeeperSentMonth).toBe("2026-09");
    // The setter saving it again before anyone else does is a plain re-save.
    expect(await set(db, shopId, BOOKS)).toEqual({ change: "resaved", confirmed: false });
  });

  it("clears the address, its provenance, its confirmation, its link and the claim together", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-clear");
    await confirmed(db, shopId);
    expect(await set(db, shopId, null)).toEqual({ change: "cleared", confirmed: false });
    expect(await readBookkeeper(db, shopId)).toBeNull();
    expect(await rowOf(db, shopId)).toMatchObject({
      bookkeeperSentMonth: null,
      bookkeeperConfirmedAt: null,
      bookkeeperConfirmTokenHash: null,
      bookkeeperConfirmExpiresAt: null,
      bookkeeperStopTokenHash: null,
    });
    expect(await set(db, shopId, null)).toEqual({ change: "none", confirmed: false });
  });

  it("re-records the saver of the same address, leaving the claim and the confirmation alone", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-same");
    await confirmed(db, shopId);
    expect(await claim(db, shopId, "2026-10")).not.toBeNull();
    const later = new Date("2026-11-05T15:00:00Z");
    // Someone else standing behind it is its own change (second-pass F1)…
    expect(await set(db, shopId, BOOKS, OTHER, later)).toEqual({
      change: "vouched",
      confirmed: true,
    });
    // …and the same person saving it again is not.
    expect(await set(db, shopId, BOOKS, OTHER, later)).toEqual({
      change: "resaved",
      confirmed: true,
    });
    expect(await rowOf(db, shopId)).toMatchObject({
      bookkeeperSentMonth: "2026-10",
      bookkeeperEmailSetByPersonId: OTHER,
      bookkeeperEmailSetAt: later,
    });
    expect((await readBookkeeper(db, shopId))?.confirmedAt).toEqual(OCT_20);
  });

  it("drops the confirmation when the address changes, so the new inbox must say yes", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-change");
    const oldLink = await confirmed(db, shopId);
    expect(await set(db, shopId, "new@example.com")).toEqual({
      change: "changed",
      confirmed: false,
    });
    expect((await readBookkeeper(db, shopId))?.confirmedAt).toBeNull();
    expect(await listBookkeeperShops(db)).toEqual([]);
    // The old link is gone with its address.
    expect(await isBookkeeperToken(db, { token: oldLink })).toBe(false);
  });

  it("refuses an address with no record of who set it, and a confirmation with no address", async () => {
    const db = await unseededTestDb();
    await expect(shopRow(db, "books-bare", { bookkeeperEmail: BOOKS })).rejects.toThrow();
    await expect(shopRow(db, "books-orphan", { bookkeeperConfirmedAt: OCT_20 })).rejects.toThrow();
  });
});

describe("the confirm link", () => {
  it("confirms only the address it was minted for, once, before it expires", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-link");
    await set(db, shopId, BOOKS);
    expect(
      await issueBookkeeperConfirmation(db, { shopId, email: "x@example.com", now: OCT_20 }),
    ).toBeNull();
    const issued = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    if (!issued) throw new Error("no link");
    expect(await checkBookkeeperConfirmation(db, { token: issued.token, now: OCT_20 })).toEqual({
      shopName: "books-link",
      email: BOOKS,
    });
    // Past its week, it confirms nothing.
    const late = new Date(issued.expiresAt.getTime() + 1);
    expect(
      await consumeBookkeeperConfirmation(db, { token: issued.token, now: late, origin: null }),
    ).toBeNull();
    expect(
      await consumeBookkeeperConfirmation(db, { token: issued.token, now: OCT_20, origin: null }),
    ).toEqual({ shopId });
    expect(await wasBookkeeperConfirmed(db, { token: issued.token })).toEqual({
      shopName: "books-link",
    });
    expect(
      await consumeBookkeeperConfirmation(db, { token: issued.token, now: OCT_20, origin: null }),
    ).toBeNull();
    // A confirmed address mints no second link.
    expect(await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 })).toBeNull();
  });

  it("is replaced by a newer link", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-relink");
    await set(db, shopId, BOOKS);
    const first = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    const second = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    if (!first || !second) throw new Error("no link");
    expect(
      await consumeBookkeeperConfirmation(db, { token: first.token, now: OCT_20, origin: null }),
    ).toBeNull();
    expect(
      await consumeBookkeeperConfirmation(db, { token: second.token, now: OCT_20, origin: null }),
    ).toEqual({ shopId });
  });

  it("starts the files with the month after it is used, however late (second-pass N2)", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-late");
    // Set on 20 October (October counts from the next 2nd); its link is used 10 December.
    await confirmed(db, shopId, BOOKS, new Date("2026-12-10T15:00:00Z"));
    expect((await rowOf(db, shopId))?.bookkeeperSentMonth).toBe("2026-11");
  });
});

describe("the month-end claim", () => {
  it("is won once per month, and only for the confirmed address still on file", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-claim");
    await set(db, shopId, BOOKS);
    // Unconfirmed: nothing to claim.
    expect(await claim(db, shopId, "2026-10")).toBeNull();
    const issued = await issueBookkeeperConfirmation(db, { shopId, email: BOOKS, now: OCT_20 });
    await consumeBookkeeperConfirmation(db, {
      token: issued?.token ?? "",
      now: OCT_20,
      origin: null,
    });
    expect(await claim(db, shopId, "2026-10", { email: "old@example.com" })).toBeNull();
    const won = await claim(db, shopId, "2026-10");
    if (!won) throw new Error("no claim");
    expect(await claim(db, shopId, "2026-10")).toBeNull();
    // A failed send gives it back, and the next pass wins it again.
    await releaseBookkeeperMonth(db, {
      shopId,
      month: "2026-10",
      email: BOOKS,
      stopToken: won.stopToken,
      previous: "2026-09",
      previousStopTokenHash: null,
    });
    expect((await rowOf(db, shopId))?.bookkeeperSentMonth).toBe("2026-09");
    expect(await claim(db, shopId, "2026-10")).not.toBeNull();
  });

  it("is lost when someone else has stood behind the address since the check (second-pass N4)", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-setter");
    await confirmed(db, shopId);
    await set(db, shopId, BOOKS, OTHER);
    expect(await claim(db, shopId, "2026-10")).toBeNull();
    expect(
      await claimBookkeeperMonth(db, {
        shopId,
        email: BOOKS,
        setByPersonId: OTHER,
        month: "2026-10",
      }),
    ).not.toBeNull();
  });

  it("never gives a failed month back onto an address changed mid-send (third-pass N1)", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-midsend");
    await confirmed(db, shopId);
    const november = await claim(db, shopId, "2026-11");
    if (!november) throw new Error("no claim");
    const previousHash = (await rowOf(db, shopId))?.bookkeeperStopTokenHash ?? null;
    const december = await claim(db, shopId, "2026-12");
    if (!december) throw new Error("no claim");
    // While December's send to BOOKS is out, a manager points it at a new
    // address, landing on the same month with no stop link; then the send fails.
    await set(db, shopId, "new@example.com");
    await db.update(shops).set({ bookkeeperSentMonth: "2026-12" }).where(eq(shops.id, shopId));
    const before = await rowOf(db, shopId);
    await releaseBookkeeperMonth(db, {
      shopId,
      month: "2026-12",
      email: BOOKS,
      stopToken: december.stopToken,
      previous: "2026-11",
      previousStopTokenHash: previousHash,
    });
    const after = await rowOf(db, shopId);
    expect(after?.bookkeeperEmail).toBe("new@example.com");
    expect(after?.bookkeeperSentMonth).toBe(before?.bookkeeperSentMonth);
    expect(after?.bookkeeperStopTokenHash).toBe(before?.bookkeeperStopTokenHash);
    // So the old recipient's November link stops nothing on the new address.
    expect(await stopBookkeeperByToken(db, { token: november.stopToken, origin: null })).toBeNull();
    expect((await readBookkeeper(db, shopId))?.email).toBe("new@example.com");
  });

  it("lists real shops with a confirmed address, never a demo shop or an unconfirmed one", async () => {
    const db = await unseededTestDb();
    const real = await shopRow(db, "books-real");
    const demo = await shopRow(db, "books-demo", { isDemo: true });
    const waiting = await shopRow(db, "books-waiting");
    await shopRow(db, "books-none");
    await confirmed(db, real);
    await confirmed(db, demo);
    await set(db, waiting, BOOKS);
    expect((await listBookkeeperShops(db)).map((shop) => shop.id)).toEqual([real]);
  });
});

describe("the stop link (second-pass N1)", () => {
  async function stopLines(db: AppDb, shopId: string) {
    return db
      .select({ code: activityEvents.code, reason: activityEvents.systemReason })
      .from(activityEvents)
      .where(eq(activityEvents.shopId, shopId));
  }

  it("stops the address it went to once, logs it with no actor, and reads back as stopped", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-stop");
    await confirmed(db, shopId);
    const won = await claim(db, shopId, "2026-10");
    if (!won) throw new Error("no claim");
    expect(await resolveBookkeeperStopToken(db, won.stopToken)).toEqual({
      shopName: "books-stop",
      alreadyStopped: false,
    });
    expect(
      await stopBookkeeperByToken(db, { token: won.stopToken, now: OCT_20, origin: null }),
    ).toEqual({ shopName: "books-stop", alreadyStopped: false });
    expect(await readBookkeeper(db, shopId)).toBeNull();
    expect(await listBookkeeperShops(db)).toEqual([]);
    expect(await stopLines(db, shopId)).toEqual([
      { code: "bookkeeper_email_stopped", reason: "bookkeeper_stopped" },
    ]);
    // A second click says so, and writes nothing more.
    expect(
      await stopBookkeeperByToken(db, { token: won.stopToken, now: OCT_20, origin: null }),
    ).toEqual({ shopName: "books-stop", alreadyStopped: true });
    expect(await stopLines(db, shopId)).toHaveLength(1);
    expect(await resolveBookkeeperStopToken(db, "not-a-token")).toBeNull();
  });

  it("works only from the newest email, and never on an address set after it", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-stop-old");
    await confirmed(db, shopId);
    const october = await claim(db, shopId, "2026-10");
    const november = await claim(db, shopId, "2026-11");
    if (!october || !november) throw new Error("no claim");
    expect(await resolveBookkeeperStopToken(db, october.stopToken)).toBeNull();
    // A send that failed hands the previous email's link back with the month.
    const previous = (await rowOf(db, shopId))?.bookkeeperStopTokenHash ?? null;
    const december = await claim(db, shopId, "2026-12");
    if (!december) throw new Error("no claim");
    await releaseBookkeeperMonth(db, {
      shopId,
      month: "2026-12",
      email: BOOKS,
      stopToken: december.stopToken,
      previous: "2026-11",
      previousStopTokenHash: previous,
    });
    expect(await resolveBookkeeperStopToken(db, november.stopToken)).not.toBeNull();
    // A new address clears the link: the old bookkeeper cannot stop the new one.
    await set(db, shopId, "new@example.com");
    expect(await stopBookkeeperByToken(db, { token: november.stopToken, origin: null })).toBeNull();
    expect((await readBookkeeper(db, shopId))?.email).toBe("new@example.com");
  });
});

describe("who hears about the address (second-pass N5)", () => {
  it("is every owner with a login while there is one", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-owners");
    const owner = await staffer(db, shopId, {
      name: "Olga",
      email: "olga@shop.example",
      role: "owner",
    });
    await staffer(db, shopId, { name: "Mia", email: "mia@shop.example", role: "manager" });
    expect(await bookkeeperNoticeRecipients(db, { shopId, actorPersonId: owner })).toEqual([
      expect.objectContaining({ personId: owner, email: "olga@shop.example" }),
    ]);
  });

  it("falls back to the managers other than the actor when no owner can sign in", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-managers");
    await staffer(db, shopId, {
      name: "Olga",
      email: "olga@shop.example",
      role: "owner",
      status: "disabled",
    });
    const mia = await staffer(db, shopId, {
      name: "Mia",
      email: "mia@shop.example",
      role: "manager",
    });
    const ned = await staffer(db, shopId, {
      name: "Ned",
      email: "ned@shop.example",
      role: "manager",
    });
    expect(await bookkeeperNoticeRecipients(db, { shopId, actorPersonId: mia })).toEqual([
      expect.objectContaining({ personId: ned, email: "ned@shop.example" }),
    ]);
  });

  it("falls back to the shop's confirmed contact address when no one else is left", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "books-desk", {
      contactEmail: "desk@shop.example",
      contactEmailConfirmedAt: OCT_20,
    });
    const mia = await staffer(db, shopId, {
      name: "Mia",
      email: "mia@shop.example",
      role: "manager",
    });
    expect(await bookkeeperNoticeRecipients(db, { shopId, actorPersonId: mia })).toEqual([
      { personId: null, fullName: null, email: "desk@shop.example", locale: null },
    ]);
    await db.update(shops).set({ contactEmailConfirmedAt: null }).where(eq(shops.id, shopId));
    expect(await bookkeeperNoticeRecipients(db, { shopId, actorPersonId: mia })).toEqual([]);
  });
});
