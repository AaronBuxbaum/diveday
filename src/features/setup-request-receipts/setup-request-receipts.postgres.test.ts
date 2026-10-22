import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { recordSetupRequest } from "@/db/funnel";
import { setupRequests } from "@/db/schema";
import { claimSetupRequestReceipt } from "@/db/setup-request-receipts";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  notificationProviderFromEnvironment: vi.fn(),
}));
const { getDb } = await import("@/db/client");
const { notificationProviderFromEnvironment } = await import("@/lib/notifications");
const { sendSetupRequestReceipt } = await import("@/features/setup-request-receipts");
const AT = new Date("2026-10-21T12:00:00Z");
const input = (email: string) => ({
  shopName: "Reef",
  region: "Keys",
  runsBoat: true,
  currentSystem: "paper" as const,
  contactName: "Requester",
  email,
  phone: null,
  source: "pricing" as const,
  locale: "en-US",
  receiptPending: true,
});
const lock = sql`select pg_advisory_xact_lock(hashtext('setup_request_receipt'))`;

/** The gate establishes overlap; the admitted claims and provider call count prove the policy. */
describePostgres("setup receipt claims across independent PostgreSQL sessions", () => {
  it("allows only one of simultaneous exact normalized-address submissions", async () => {
    const pg = await postgresTestDb();
    const rows = [];
    for (const address of ["Victim@Reef.mail", "victim@reef.mail", " VICTIM@reef.mail "]) {
      rows.push(await recordSetupRequest(pg.db, input(address)));
    }
    const gate = await holdRowLock(pg, lock);
    const attempts = rows.map((row) => claimSetupRequestReceipt(pg.connect(), row.id, AT));
    try {
      await waitForLockWaiters(pg.db, attempts.length);
    } finally {
      await gate.release();
    }
    expect((await Promise.all(attempts)).filter(Boolean)).toHaveLength(1);
    const saved = await pg.db.select().from(setupRequests);
    expect(saved.filter((row) => row.receiptStatus === "claimed")).toHaveLength(1);
    expect(
      saved.filter((row) => row.receiptStatus === "suppressed" && row.receiptClaimedAt === null),
    ).toHaveLength(2);
  });

  it("admits exactly one of simultaneous claims when the rolling global count is 29", async () => {
    const pg = await postgresTestDb();
    for (let index = 0; index < 29; index += 1) {
      await pg.db.insert(setupRequests).values({
        ...input(`previous${index}@reef.mail`),
        receiptStatus: "failed",
        receiptClaimedAt: AT,
        receiptErrorCode: "not_configured",
      });
    }
    const rows = [
      await recordSetupRequest(pg.db, input("one@reef.mail")),
      await recordSetupRequest(pg.db, input("two@reef.mail")),
    ];
    const gate = await holdRowLock(pg, lock);
    const attempts = rows.map((row) => claimSetupRequestReceipt(pg.connect(), row.id, AT));
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect((await Promise.all(attempts)).sort()).toEqual([false, true]);
    const saved = await pg.db.select().from(setupRequests);
    expect(saved.filter((row) => row.receiptClaimedAt !== null)).toHaveLength(30);
    expect(saved.filter((row) => row.receiptErrorCode === "global_limit")).toHaveLength(1);
  });

  it("sends once while the winner's provider is suspended and releases the claim lock before HTTP", async () => {
    const pg = await postgresTestDb();
    const row = await recordSetupRequest(pg.db, input("one@reef.mail"));
    vi.mocked(getDb).mockImplementation(async () => pg.connect());
    let releaseSend!: () => void;
    const heldSend = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    onTestFinished(() => releaseSend());
    let startedSend!: () => void;
    const started = new Promise<void>((resolve) => {
      startedSend = resolve;
    });
    let reportDuplicate!: () => void;
    const duplicate = new Promise<"duplicate">((resolve) => {
      reportDuplicate = () => resolve("duplicate");
    });
    const send = vi.fn(async () => {
      if (send.mock.calls.length > 1) reportDuplicate();
      startedSend();
      await heldSend;
      return { status: "sent" as const, providerMessageId: "ses-race" };
    });
    vi.mocked(notificationProviderFromEnvironment).mockReturnValue({ send });
    const gate = await holdRowLock(pg, lock);
    const dispatches = [sendSetupRequestReceipt(row.id), sendSetupRequestReceipt(row.id)];
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    try {
      expect(
        await Promise.race([...dispatches.map((task) => task.then(() => "finished")), duplicate]),
      ).toBe("finished");
      await started;
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await pg.db.select().from(setupRequests).where(eq(setupRequests.id, row.id)),
      ).toMatchObject([{ receiptStatus: "claimed" }]);
      // This independent transaction must finish before the provider is released.
      const another = await recordSetupRequest(pg.db, input("different@reef.mail"));
      expect(await claimSetupRequestReceipt(pg.connect(), another.id)).toBe(true);
    } finally {
      releaseSend();
    }
    await Promise.all(dispatches);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await pg.db.select().from(setupRequests).where(eq(setupRequests.id, row.id)),
    ).toMatchObject([{ receiptStatus: "accepted", receiptProviderMessageId: "ses-race" }]);
    await sendSetupRequestReceipt(row.id);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
