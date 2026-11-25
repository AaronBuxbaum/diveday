import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { DIVER_SESSION_TTL_MS, DIVER_SIGN_IN_TTL_MS } from "@/lib/capabilities";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/records/anonymize";
import { mergeDiverRecords } from "./diver-merge";
import {
  endDiverSession,
  issueDiverSignIn,
  lockDiverSession,
  readDiverSession,
  startDiverSession,
} from "./diver-sign-in";
import { capabilities, people, personRoles, shops } from "./schema";

/**
 * ADR 20261125-diver-sign-in, security-sensitive (a bearer link and a session):
 * the link opens a session for the person it was mailed to and nobody else,
 * once, for a short while; the session reads as that person in that shop only,
 * and opens nothing once the person is signed out, merged away or erased.
 */
const ctx = fileScopedShopContext();

async function diver(email = "ana-signin@example.com", fullName = "Ana Reyes") {
  const [person] = await ctx.db
    .insert(people)
    .values({ shopId: ctx.shop.id, fullName, email })
    .returning();
  if (!person) throw new Error("fixture insert failed");
  await ctx.db.insert(personRoles).values({ personId: person.id, role: "diver" });
  return person;
}

async function owner() {
  const [row] = await ctx.db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, ctx.shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row.id;
}

async function signedIn(personEmail: string) {
  const issued = await issueDiverSignIn(ctx.db, { shopId: ctx.shop.id, email: personEmail });
  if (!issued) throw new Error("expected a link");
  const session = await startDiverSession(ctx.db, { token: issued.token });
  if (!session) throw new Error("expected a session");
  return session;
}

describe("diver sign-in", () => {
  it("opens a session for the person the link was mailed to, and only them", async () => {
    const ana = await diver();
    await diver("ben-signin@example.com", "Ben Ortiz");
    const issued = await issueDiverSignIn(ctx.db, {
      shopId: ctx.shop.id,
      email: "  ANA-signin@Example.com ",
    });
    expect(issued?.person).toMatchObject({ id: ana.id, email: "ana-signin@example.com" });
    const [row] = await ctx.db
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, issued?.tokenId ?? ""));
    // Hashed at rest: the token itself is nowhere in the row.
    expect(row?.tokenHash).toBe(hashBearerToken(issued?.token ?? ""));
    expect(JSON.stringify(row)).not.toContain(issued?.token);

    const session = await startDiverSession(ctx.db, { token: issued?.token ?? "" });
    expect(session).toMatchObject({ shopId: ctx.shop.id, personId: ana.id });
    expect(await readDiverSession(ctx.db, { shopId: ctx.shop.id, token: session?.token })).toEqual(
      expect.objectContaining({ personId: ana.id }),
    );
  });

  it("mints nothing for an address the shop does not hold", async () => {
    await diver();
    expect(
      await issueDiverSignIn(ctx.db, { shopId: ctx.shop.id, email: "nobody@example.com" }),
    ).toBeNull();
    expect(await issueDiverSignIn(ctx.db, { shopId: ctx.shop.id, email: "" })).toBeNull();
  });

  it("spends the link once", async () => {
    await diver();
    const issued = await issueDiverSignIn(ctx.db, {
      shopId: ctx.shop.id,
      email: "ana-signin@example.com",
    });
    const token = issued?.token ?? "";
    expect(await startDiverSession(ctx.db, { token })).not.toBeNull();
    expect(await startDiverSession(ctx.db, { token })).toBeNull();
  });

  it("leaves an earlier link working when a second is requested", async () => {
    await diver();
    const first = await issueDiverSignIn(ctx.db, {
      shopId: ctx.shop.id,
      email: "ana-signin@example.com",
    });
    await issueDiverSignIn(ctx.db, { shopId: ctx.shop.id, email: "ana-signin@example.com" });
    expect(await startDiverSession(ctx.db, { token: first?.token ?? "" })).not.toBeNull();
  });

  it("expires the link", async () => {
    await diver();
    const issued = await issueDiverSignIn(ctx.db, {
      shopId: ctx.shop.id,
      email: "ana-signin@example.com",
      now: new Date(nowDate().getTime() - DIVER_SIGN_IN_TTL_MS - 1000),
    });
    expect(await startDiverSession(ctx.db, { token: issued?.token ?? "" })).toBeNull();
  });

  it("refuses a link whose person was deleted after it was mailed, and leaves it unspent", async () => {
    const ana = await diver();
    const issued = await issueDiverSignIn(ctx.db, {
      shopId: ctx.shop.id,
      email: "ana-signin@example.com",
    });
    await ctx.db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, ana.id));
    expect(await startDiverSession(ctx.db, { token: issued?.token ?? "" })).toBeNull();
    const [row] = await ctx.db
      .select({ usedAt: capabilities.usedAt })
      .from(capabilities)
      .where(eq(capabilities.id, issued?.tokenId ?? ""));
    expect(row?.usedAt).toBeNull();
  });

  it("reads as nobody in another shop", async () => {
    await diver();
    const session = await signedIn("ana-signin@example.com");
    const [other] = await ctx.db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-signin", timezone: "UTC" })
      .returning();
    expect(
      await readDiverSession(ctx.db, { shopId: other?.id ?? "", token: session.token }),
    ).toBeNull();
    expect(
      await issueDiverSignIn(ctx.db, { shopId: other?.id ?? "", email: "ana-signin@example.com" }),
    ).toBeNull();
  });

  it("ends on sign out and on expiry", async () => {
    await diver();
    const session = await signedIn("ana-signin@example.com");
    const later = new Date(nowDate().getTime() + DIVER_SESSION_TTL_MS + 1000);
    expect(
      await readDiverSession(ctx.db, { shopId: ctx.shop.id, token: session.token, now: later }),
    ).toBeNull();
    await endDiverSession(ctx.db, { token: session.token });
    expect(
      await readDiverSession(ctx.db, { shopId: ctx.shop.id, token: session.token }),
    ).toBeNull();
    expect(
      await lockDiverSession(ctx.db, { shopId: ctx.shop.id, token: session.token }),
    ).toBeNull();
  });

  it("is dead once the person is erased", async () => {
    const ana = await diver();
    const session = await signedIn("ana-signin@example.com");
    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: ana.id,
      actorPersonId: await owner(),
    });
    expect(erased.ok).toBe(true);
    expect(
      await readDiverSession(ctx.db, { shopId: ctx.shop.id, token: session.token }),
    ).toBeNull();
    expect(
      await ctx.db.select().from(capabilities).where(eq(capabilities.personId, ana.id)),
    ).toEqual([]);
  });

  it("lets a merge go ahead and leaves the merged-away session opening nothing", async () => {
    const source = await diver("rita-old-signin@example.com", "Rita Feed");
    const survivor = await diver("rita-new-signin@example.com", "Rita Feed");
    const session = await signedIn("rita-old-signin@example.com");
    const merged = await mergeDiverRecords({
      db: ctx.db,
      shopId: ctx.shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: await owner(),
    });
    expect(merged).toMatchObject({ ok: true });
    expect(
      await readDiverSession(ctx.db, { shopId: ctx.shop.id, token: session.token }),
    ).toBeNull();
  });

  it("refuses a token of the wrong shape without a query", async () => {
    expect(await startDiverSession(ctx.db, { token: "short" })).toBeNull();
    expect(
      await readDiverSession(ctx.db, { shopId: ctx.shop.id, token: "x".repeat(44) }),
    ).toBeNull();
  });
});
