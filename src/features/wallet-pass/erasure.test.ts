// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  bookings,
  people,
  personRoles,
  tripAssignments,
  trips,
  userAccounts,
  walletPasses,
  walletPassRegistrations,
} from "@/db/schema";
import { anonymizeDiver } from "@/features/anonymize";
import { removeStaffMember } from "@/features/staff-accounts";
import { fileScopedShopContext } from "@/test/db";
import { generateWalletTestCredentials } from "@/test/wallet-credentials";
import { googlePassObject } from "./google";
import { passAuthenticationToken } from "./rules";
import { applePassService } from "./service";
import { issueWalletPass, pushChangedWalletPasses } from "./store";

const ctx = fileScopedShopContext({ realShop: true });
const generated = generateWalletTestCredentials();
const alias = "CrewUniqueErasure";
beforeEach(() => {
  vi.stubEnv("DIVEDAY_CLOCK", "2026-07-20T00:00:00Z");
  vi.stubEnv("APP_HOST", "https://test.invalid");
  vi.stubEnv("APPLE_PASS_TYPE_ID", "pass.app.diveday.test");
  vi.stubEnv("APPLE_TEAM_ID", "TESTTEAM01");
  vi.stubEnv("APPLE_PASS_CERTIFICATE_PEM", generated.certificate);
  vi.stubEnv("APPLE_PASS_KEY_PEM", generated.key);
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "12345");
  vi.stubEnv(
    "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    JSON.stringify({ client_email: "test@test.invalid", private_key: generated.key }),
  );
});
afterEach(() => vi.unstubAllEnvs());

it("erases a former crew member from owned and bystander expired snapshots and both final provider payloads", async () => {
  const db = ctx.db,
    shopId = ctx.shop.id;
  const [subject] = await db
    .insert(people)
    .values({
      shopId,
      fullName: "Crew Wallet Subject",
      crewPublicName: alias,
      crewPublicConsentAt: new Date("2026-07-20T00:00:00Z"),
    })
    .returning();
  await db.insert(personRoles).values([
    { personId: subject.id, role: "diver" },
    { personId: subject.id, role: "divemaster" },
  ]);
  const [account] = await db
    .insert(userAccounts)
    .values({
      personId: subject.id,
      email: "crew-wallet-erasure@example.test",
      hashedPassword: "test",
    })
    .returning();
  const [bystander] = await db
    .insert(people)
    .values({ shopId, fullName: "Bystander Wallet Diver" })
    .returning();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Erasure reef",
      startsAt: new Date("2026-07-21T12:00:00Z"),
      endsAt: new Date("2026-07-21T16:00:00Z"),
      capacity: 10,
    })
    .returning();
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: subject.id });
  const seats = await db
    .insert(bookings)
    .values([
      { shopId, tripId: trip.id, personId: subject.id, bookedAs: "diver" },
      { shopId, tripId: trip.id, personId: bystander.id, bookedAs: "diver" },
    ])
    .returning();
  const passes = [];
  for (const seat of seats)
    for (const platform of ["apple", "google"] as const) {
      const pass = await issueWalletPass(db, {
        shopId,
        bookingId: seat.id,
        platform,
        locale: "en-US",
      });
      if (!pass) throw new Error("expected issued pass");
      expect(JSON.stringify(pass.contentJson)).toContain(alias);
      passes.push({ pass, owned: seat.personId === subject.id });
      if (platform === "apple")
        await applePassService.register(db, {
          passTypeIdentifier: "pass.app.diveday.test",
          serialNumber: pass.id,
          token: passAuthenticationToken(pass.id),
          deviceLibraryIdentifier: `device-${pass.id}`,
          pushToken: "a".repeat(64),
        });
    }
  const providers = { apple: vi.fn(async () => 200), google: vi.fn(async () => {}) };
  expect(await pushChangedWalletPasses(db, { providers })).toMatchObject({
    examined: 4,
    pushed: 4,
  });
  vi.stubEnv("DIVEDAY_CLOCK", "2026-07-30T00:00:00Z");
  expect(
    await removeStaffMember(db, { shopId, personId: subject.id, userAccountId: account.id }),
  ).toEqual({ ok: true });
  const [actor] = await db
    .select({ id: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  expect(
    (await anonymizeDiver(db, { shopId, personId: subject.id, actorPersonId: actor.id })).ok,
  ).toBe(true);
  for (const { pass, owned } of passes.toSorted((a, b) => Number(a.owned) - Number(b.owned))) {
    const [stored] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
    expect(JSON.stringify(stored.contentJson)).not.toContain(alias);
    expect(stored.contentJson.voided).toBe(owned);
    if (!owned) expect(stored.authenticationTokenHash).toBe(pass.authenticationTokenHash);
    if (owned) expect(JSON.stringify(stored.contentJson)).not.toContain(subject.fullName);
    if (pass.platform === "apple") {
      const latest = await applePassService.latest(db, {
        passTypeIdentifier: "pass.app.diveday.test",
        serialNumber: pass.id,
        token: passAuthenticationToken(pass.id),
      });
      if (owned) expect(latest).toBe(404);
      else {
        if (typeof latest === "number")
          throw new Error("bystander download must remain authorized");
        const document = strFromU8(unzipSync(latest.bytes)["pass.json"]);
        expect(document).not.toContain(alias);
        expect(document).toContain(bystander.fullName);
        const [registration] = await db
          .select()
          .from(walletPassRegistrations)
          .where(eq(walletPassRegistrations.passId, pass.id));
        expect(registration.deletedAt).toBeNull();
      }
    } else {
      const object = googlePassObject(
        pass.googleObjectId ?? "",
        stored.contentJson,
        stored.issuedAt,
        stored.locale,
      );
      expect(JSON.stringify(object)).not.toContain(alias);
      expect(object.state).toBe(owned ? "INACTIVE" : "ACTIVE");
    }
  }
  // Expired snapshots still get their final scrubbed provider update, then stop scanning.
  expect(await pushChangedWalletPasses(db, { providers })).toMatchObject({
    examined: 4,
    pushed: 4,
    failed: 0,
  });
  const refreshed = await db.select().from(walletPasses).where(eq(walletPasses.shopId, shopId));
  expect(JSON.stringify(refreshed)).not.toContain(alias);
  expect(await pushChangedWalletPasses(db, { providers })).toMatchObject({
    examined: 0,
    pushed: 0,
  });
});
