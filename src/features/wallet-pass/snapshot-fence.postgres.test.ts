// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import type { AppDb } from "@/db/client";
import { bookings, people, shops, trips } from "@/db/schema";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { generateWalletTestCredentials } from "@/test/wallet-credentials";
import { issueWalletPass, pushChangedWalletPasses } from "./store";

const generated = generateWalletTestCredentials();
beforeEach(() => {
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

async function fixture(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Wallet fence", slug: "wallet-fence", timezone: "UTC" })
    .returning();
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Wallet Diver" })
    .returning();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Fence reef",
      startsAt: new Date("2026-07-22T12:00:00Z"),
      endsAt: new Date("2026-07-22T16:00:00Z"),
      capacity: 10,
    })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  return { shopId: shop.id, bookingId: booking.id, locale: "en-US" };
}

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describePostgres("Wallet snapshot writers share the person-rewrite fence", () => {
  it("does not build an issued snapshot while erasure owns the rewrite fence", async () => {
    const pg = await postgresTestDb();
    const input = await fixture(pg.db);
    const entered = latch(),
      release = latch();
    const rewrite = pg.connect().transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, input.shopId, "rewrite");
      entered.release();
      await release.promise;
    });
    await entered.promise;
    const issuing = issueWalletPass(pg.connect(), { ...input, platform: "apple" });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release.release();
    }
    expect(await issuing).not.toBeNull();
    await rewrite;
  });
  it("holds the shared fence through delivery so erasure cannot commit before a stale writer", async () => {
    const pg = await postgresTestDb();
    const input = await fixture(pg.db);
    await issueWalletPass(pg.db, { ...input, platform: "google" });
    const delivering = latch(),
      release = latch();
    const push = pushChangedWalletPasses(pg.connect(), {
      providers: {
        apple: async () => 200,
        google: async () => {
          delivering.release();
          await release.promise;
        },
      },
    });
    await delivering.promise;
    const rewrite = pg.connect().transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, input.shopId, "rewrite");
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release.release();
    }
    expect(await push).toMatchObject({ pushed: 1, failed: 0 });
    await rewrite;
  });
});
