// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookings,
  people,
  personRoles,
  shops,
  tripStageEvents,
  trips,
  walletPasses,
  walletPassRegistrations,
} from "@/db/schema";
import { anonymizeDiver } from "@/features/anonymize";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import type { ParticipantType } from "@/lib/participant-types";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { generateWalletTestCredentials } from "@/test/wallet-credentials";
import { googlePassObject } from "./google";
import { passAuthenticationToken } from "./rules";
import { applePassService } from "./service";
import {
  issueWalletPass,
  pushChangedWalletPasses,
  renderApplePass,
  voidWalletPassesForPerson,
} from "./store";

const ctx = fileScopedShopContext();
const credentials = generateWalletTestCredentials();
beforeEach(() => {
  vi.stubEnv("APPLE_PASS_TYPE_ID", "pass.app.diveday.test");
  vi.stubEnv("APPLE_TEAM_ID", "TESTTEAM01");
  vi.stubEnv("APPLE_PASS_CERTIFICATE_PEM", credentials.certificate);
  vi.stubEnv("APPLE_PASS_KEY_PEM", credentials.key);
  vi.stubEnv("APP_HOST", "https://test.invalid");
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "12345");
  vi.stubEnv(
    "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    JSON.stringify({ client_email: "generated@test.invalid", private_key: credentials.key }),
  );
});
afterEach(() => vi.unstubAllEnvs());

async function fixture(
  platform: "apple" | "google" = "apple",
  participantType: ParticipantType = "diver",
  locale = "en-US",
) {
  const db = ctx.db,
    shopId = ctx.shop.id;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: "Yara Wallet Test" })
    .returning();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Wallet reef",
      startsAt: new Date("2026-07-22T12:00:00Z"),
      endsAt: new Date("2026-07-22T16:00:00Z"),
      capacity: 10,
    })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({
      shopId,
      tripId: trip.id,
      personId: person.id,
      bookedAs: participantType,
      participantType,
    })
    .returning();
  const input = { shopId, bookingId: booking.id, platform, locale };
  const pass = await issueWalletPass(db, input);
  if (!pass) throw new Error("expected an issued pass");
  const identity = {
    passTypeIdentifier: "pass.app.diveday.test",
    serialNumber: pass.id,
    token: passAuthenticationToken(pass.id),
  };
  return { db, shopId, person, trip, booking, input, pass, identity };
}
const providers = () => ({
  apple: vi.fn(async (_token: string) => 200),
  google: vi.fn(async (_id: string, _content: unknown, _issued: Date, _locale: string) => {}),
});

describe("native departure pass lifecycle", () => {
  it("issues idempotently with hash-only auth, a stored locale and a tenant-bound booking", async () => {
    const { db, shopId, input, pass } = await fixture();
    expect((await issueWalletPass(db, { ...input, locale: "es-ES" }))?.id).toBe(pass.id);
    expect(pass.locale).toBe("en-US");
    expect(pass.authenticationTokenHash).toBe(hashBearerToken(passAuthenticationToken(pass.id)));
    expect(JSON.stringify(pass)).not.toContain(passAuthenticationToken(pass.id));
    const [other] = await db
      .insert(shops)
      .values({ name: "Other shop", slug: "wallet-other", timezone: "UTC" })
      .returning();
    expect(await issueWalletPass(db, { ...input, shopId: other.id })).toBeNull();
    const [row] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
    expect(row.shopId).toBe(shopId);
  });
  it("authenticates registration and latest, reuses a device and respects conditional fetches", async () => {
    advanceClock(250);
    const { db, pass, identity } = await fixture();
    const registration = {
      ...identity,
      deviceLibraryIdentifier: "device-one",
      pushToken: "a".repeat(64),
    };
    expect(await applePassService.register(db, { ...registration, token: "wrong" })).toBe(401);
    expect(
      await applePassService.register(db, {
        ...registration,
        serialNumber: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe(404);
    expect(await applePassService.register(db, registration)).toBe(201);
    expect(
      await applePassService.register(db, { ...registration, pushToken: "b".repeat(64) }),
    ).toBe(200);
    expect(
      await applePassService.latest(db, { ...identity, ifModifiedSince: pass.updatedAt }),
    ).toBe(304);
    expect(
      await applePassService.latest(db, {
        ...identity,
        ifModifiedSince: new Date(pass.updatedAt.getTime() - 1),
      }),
    ).toMatchObject({ lastModified: pass.updatedAt });
    expect(
      await applePassService.latest(db, {
        ...identity,
        ifModifiedSince: new Date(pass.updatedAt.getTime() - 1000),
      }),
    ).toMatchObject({ lastModified: pass.updatedAt });
    expect(
      await applePassService.updatedSince(db, {
        ...registration,
        deviceLibraryIdentifier: "another-device",
      }),
    ).toBe(204);
    expect(await applePassService.updatedSince(db, registration)).toMatchObject({
      serialNumbers: [pass.id],
    });
    expect(
      await applePassService.updatedSince(db, {
        ...registration,
        passesUpdatedSince: pass.updatedAt.toISOString(),
      }),
    ).toBe(204);
    expect(await applePassService.unregister(db, registration)).toBe(200);
    expect(await applePassService.updatedSince(db, registration)).toBe(204);
    expect(await applePassService.register(db, registration)).toBe(201);
  });
  it("updates a moved departure once, publishes a recorded stage and retires 410 devices", async () => {
    const { db, pass, trip, identity, shopId, person } = await fixture();
    await applePassService.register(db, {
      ...identity,
      deviceLibraryIdentifier: "device-one",
      pushToken: "a".repeat(64),
    });
    const send = providers();
    await pushChangedWalletPasses(db, { providers: send });
    send.apple.mockClear();
    advanceClock(60_000);
    await db
      .update(trips)
      .set({ startsAt: new Date("2026-07-22T13:00:00Z"), revision: trip.revision + 1 })
      .where(eq(trips.id, trip.id));
    expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({
      pushed: 1,
      failed: 0,
    });
    expect(send.apple).toHaveBeenCalledTimes(1);
    expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({ pushed: 0 });
    // The moved departure is tomorrow; a stage begins speaking on its local day.
    advanceClock(24 * 60 * 60 * 1000);
    await db
      .insert(tripStageEvents)
      .values({ shopId, tripId: trip.id, stage: "boarding", recordedByPersonId: person.id });
    advanceClock();
    send.apple.mockResolvedValue(410);
    expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({ pushed: 1 });
    const [stored] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
    expect(stored.contentJson.headerFields[0]?.value).toBe("Boarding");
    const [registration] = await db
      .select()
      .from(walletPassRegistrations)
      .where(eq(walletPassRegistrations.passId, pass.id));
    expect(registration.deletedAt).not.toBeNull();
  });
  it("pushes changed Google objects, voids cancellation, and retries failures without stopping the batch", async () => {
    const google = await fixture("google"),
      apple = await fixture();
    const send = providers();
    send.google.mockRejectedValueOnce(
      new Error("provider contains a secret which must not be logged"),
    );
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await pushChangedWalletPasses(ctx.db, { providers: send })).toMatchObject({
      examined: 2,
      pushed: 1,
      failed: 1,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("provider contains");
    expect(await pushChangedWalletPasses(ctx.db, { providers: send })).toMatchObject({
      pushed: 1,
      failed: 0,
    });
    advanceClock();
    await ctx.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, google.booking.id));
    expect(await pushChangedWalletPasses(ctx.db, { providers: send })).toMatchObject({ pushed: 1 });
    expect(send.google.mock.calls.at(-1)?.[1]).toMatchObject({ voided: true });
    expect((await renderApplePass(ctx.db, apple.pass.id))?.bytes.length).toBeGreaterThan(0);
    logger.mockRestore();
  });
  it.each(["reject", "503"])(
    "commits cancellation despite Apple %s, preserves live devices and retries once",
    async (failure) => {
      const { db, pass, booking, identity } = await fixture();
      for (const device of ["gone", "live"])
        await applePassService.register(db, {
          ...identity,
          deviceLibraryIdentifier: device,
          pushToken: device === "gone" ? "a".repeat(64) : "b".repeat(64),
        });
      const send = providers();
      await pushChangedWalletPasses(db, { providers: send });
      const [published] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
      await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
      // Keep the clock frozen: the new snapshot must still advance the update tag.
      send.apple.mockImplementation(async (token: string) => {
        if (token === "a".repeat(64)) return 410;
        if (failure === "503") return 503;
        throw new Error("private provider failure");
      });
      expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({
        failed: 1,
        pushed: 0,
      });
      const [pending] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
      expect(pending.contentJson.voided).toBe(true);
      expect(pending.updatedAt.getTime()).toBeGreaterThan(published.updatedAt.getTime());
      expect(pending.lastPushedAt).toEqual(published.lastPushedAt);
      const latest = await applePassService.latest(db, {
        ...identity,
        ifModifiedSince: published.updatedAt,
      });
      if (typeof latest === "number") throw new Error(`expected current archive, got ${latest}`);
      expect(JSON.parse(strFromU8(unzipSync(latest.bytes)["pass.json"]))).toMatchObject({
        voided: true,
      });
      const registrations = await db
        .select()
        .from(walletPassRegistrations)
        .where(eq(walletPassRegistrations.passId, pass.id));
      expect(
        registrations.find((row) => row.deviceLibraryIdentifier === "gone")?.deletedAt,
      ).not.toBeNull();
      expect(
        registrations.find((row) => row.deviceLibraryIdentifier === "live")?.deletedAt,
      ).toBeNull();
      send.apple.mockReset().mockResolvedValue(200);
      expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({
        failed: 0,
        pushed: 1,
      });
      expect(send.apple.mock.calls).toEqual([["b".repeat(64)]]);
      expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({
        failed: 0,
        pushed: 0,
      });
      expect(send.apple).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps the cancelled Google snapshot inactive during an outage and retries unchanged content", async () => {
    const { db, pass, trip } = await fixture("google");
    const send = providers();
    await pushChangedWalletPasses(db, { providers: send });
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    send.google.mockRejectedValueOnce(new Error("private provider failure"));
    expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({
      failed: 1,
      pushed: 0,
    });
    const [pending] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
    expect(pending.contentJson.voided).toBe(true);
    if (!pending.googleObjectId) throw new Error("expected Google object id");
    expect(
      googlePassObject(
        pending.googleObjectId,
        pending.contentJson,
        pending.issuedAt,
        pending.locale,
      ),
    ).toMatchObject({ state: "INACTIVE" });
    send.google.mockClear();
    expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({
      failed: 0,
      pushed: 1,
    });
    expect(send.google.mock.calls[0]?.[1]).toMatchObject({ voided: true });
    expect(await pushChangedWalletPasses(db, { providers: send })).toMatchObject({ pushed: 0 });
    expect(send.google).toHaveBeenCalledTimes(1);
  });
  it.each(["apple", "google"] as const)(
    "retries %s cancellation when an earlier-started scan follows a newer successful delivery",
    async (platform) => {
      const { db, pass, booking, identity } = await fixture(platform);
      if (platform === "apple")
        await applePassService.register(db, {
          ...identity,
          deviceLibraryIdentifier: "live",
          pushToken: "a".repeat(64),
        });
      const send = providers();
      const at = (offset: number) => new Date(pass.updatedAt.getTime() + offset);
      await pushChangedWalletPasses(db, { now: at(120_000), providers: send });
      await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
      send.apple.mockRejectedValueOnce(new Error("provider unavailable"));
      send.google.mockRejectedValueOnce(new Error("provider unavailable"));
      expect(await pushChangedWalletPasses(db, { now: at(60_000), providers: send })).toMatchObject(
        { failed: 1, pushed: 0 },
      );
      const [pending] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
      expect(pending.contentJson.voided).toBe(true);
      expect(pending.updatedAt.getTime()).toBeGreaterThan(pending.lastPushedAt?.getTime() ?? 0);
      expect(
        await pushChangedWalletPasses(db, { now: at(180_000), providers: send }),
      ).toMatchObject({ failed: 0, pushed: 1 });
      expect(
        await pushChangedWalletPasses(db, { now: at(180_000), providers: send }),
      ).toMatchObject({ failed: 0, pushed: 0 });
    },
  );
  it.each([
    ["rider", "en-US", "Name"],
    ["snorkeler", "es-ES", "Nombre"],
  ] as const)(
    "labels a %s's name without implying they are diving (%s)",
    async (participantType, locale, label) => {
      const { pass, person } = await fixture("apple", participantType, locale);
      expect(pass.contentJson.auxiliaryFields.find((field) => field.key === "diver")).toEqual({
        key: "diver",
        label,
        value: person.fullName,
      });
    },
  );
  it("erasure removes the name, revokes registrations and refuses future downloads and issuance", async () => {
    const { db, pass, person, identity, shopId, input } = await fixture();
    await applePassService.register(db, {
      ...identity,
      deviceLibraryIdentifier: "device-one",
      pushToken: "a".repeat(64),
    });
    const [actor] = await db
      .select({ id: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
      .limit(1);
    const erased = await anonymizeDiver(db, {
      shopId,
      personId: person.id,
      actorPersonId: actor.id,
    });
    expect(erased.ok).toBe(true);
    const [stored] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
    expect(stored.contentJson.voided).toBe(true);
    expect(JSON.stringify(stored.contentJson)).not.toContain(person.fullName);
    expect(stored.deletedAt).not.toBeNull();
    expect(await applePassService.latest(db, identity)).toBe(404);
    expect(
      await applePassService.register(db, {
        ...identity,
        deviceLibraryIdentifier: "device-two",
        pushToken: "a".repeat(64),
      }),
    ).toBe(404);
    expect(await issueWalletPass(db, input)).toBeNull();
    await voidWalletPassesForPerson(db, { shopId, personId: person.id });
    expect(await pushChangedWalletPasses(db, { providers: providers() })).toMatchObject({
      failed: 0,
    });
  });
  it("a revoked row opens nothing and hash mismatch replaces the pass on an explicit re-add", async () => {
    const { db, pass, input, identity } = await fixture();
    // Models AUTH_SECRET rotation: installed clients still hold their old token.
    await db
      .update(walletPasses)
      .set({ authenticationTokenHash: hashBearerToken("previous-key-token") })
      .where(eq(walletPasses.id, pass.id));
    expect(
      await applePassService.latest(db, {
        ...identity,
        token: "previous-key-token",
        ifModifiedSince: pass.updatedAt,
      }),
    ).toBe(304);
    const replaced = await issueWalletPass(db, input);
    expect(replaced?.id).not.toBe(pass.id);
    expect(await applePassService.latest(db, identity)).toBe(404);
    expect(nowDate()).toBeInstanceOf(Date);
  });
});
