import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS } from "@/lib/clock";
import { unseededTestDb } from "@/test/db";
import { deleteSetupRequestsByEmail, recordSetupRequest } from "./funnel";
import { setupRequests } from "./schema";
import {
  claimSetupRequestReceipt,
  finishSetupRequestReceipt,
  readClaimedSetupRequestReceipt,
} from "./setup-request-receipts";

const AT = new Date("2026-10-21T12:00:00Z");
function input(email = "requester@reef.invalid") {
  return {
    shopName: "Reef",
    region: "Keys",
    runsBoat: true,
    currentSystem: "paper" as const,
    contactName: "Requester",
    email,
    phone: null,
    source: "pricing" as const,
    locale: "es-ES",
    receiptPending: true,
  };
}

describe("set-up receipt claims", () => {
  it("opts in public inserts only, and terminally claims one saved row once", async () => {
    const db = await unseededTestDb();
    const historical = await recordSetupRequest(db, { ...input(), receiptPending: false });
    expect(await claimSetupRequestReceipt(db, historical.id, AT)).toBe(false);
    const row = await recordSetupRequest(db, input());
    expect(await claimSetupRequestReceipt(db, row.id, AT)).toBe(true);
    expect(await claimSetupRequestReceipt(db, row.id, AT)).toBe(false);
    expect(await readClaimedSetupRequestReceipt(db, row.id)).toEqual({
      email: "requester@reef.invalid",
      locale: "es-ES",
    });
    await finishSetupRequestReceipt(db, row.id, {
      status: "accepted",
      providerMessageId: "ses-id",
    });
    expect(await readClaimedSetupRequestReceipt(db, row.id)).toBeNull();
    expect(await claimSetupRequestReceipt(db, row.id, new Date(AT.getTime() + DAY_MS))).toBe(false);
    expect(await db.select().from(setupRequests).where(eq(setupRequests.id, row.id))).toMatchObject(
      [
        {
          receiptStatus: "accepted",
          receiptClaimedAt: AT,
          receiptProviderMessageId: "ses-id",
          receiptErrorCode: null,
        },
      ],
    );
  });

  it("normalizes exact addresses without collapsing aliases; suppressed rows do not extend cooldown", async () => {
    const db = await unseededTestDb();
    const first = await recordSetupRequest(db, input("  Requester@Reef.invalid  "));
    expect(await claimSetupRequestReceipt(db, first.id, AT)).toBe(true);
    const duplicate = await recordSetupRequest(db, input("requester@reef.invalid"));
    expect(
      await claimSetupRequestReceipt(db, duplicate.id, new Date(AT.getTime() + DAY_MS - 1)),
    ).toBe(false);
    expect(
      await db.select().from(setupRequests).where(eq(setupRequests.id, duplicate.id)),
    ).toMatchObject([
      { receiptStatus: "suppressed", receiptClaimedAt: null, receiptErrorCode: "address_cooldown" },
    ]);
    const alias = await recordSetupRequest(db, input("requester+other@reef.invalid"));
    expect(await claimSetupRequestReceipt(db, alias.id, AT)).toBe(true);
    const later = await recordSetupRequest(db, input());
    expect(await claimSetupRequestReceipt(db, later.id, new Date(AT.getTime() + DAY_MS))).toBe(
      true,
    );
  });

  it("admits thirty claims per rolling hour, including failed and unresolved sends", async () => {
    const db = await unseededTestDb();
    for (let index = 0; index < 30; index += 1) {
      const row = await recordSetupRequest(db, input(`person${index}@reef.invalid`));
      expect(await claimSetupRequestReceipt(db, row.id, AT)).toBe(true);
      if (index % 2)
        await finishSetupRequestReceipt(db, row.id, {
          status: "failed",
          errorCode: "not_configured",
        });
    }
    const refused = await recordSetupRequest(db, input("next@reef.invalid"));
    expect(
      await claimSetupRequestReceipt(db, refused.id, new Date(AT.getTime() + HOUR_MS - 1)),
    ).toBe(false);
    expect(
      await db.select().from(setupRequests).where(eq(setupRequests.id, refused.id)),
    ).toMatchObject([
      { receiptStatus: "suppressed", receiptClaimedAt: null, receiptErrorCode: "global_limit" },
    ]);
    const next = await recordSetupRequest(db, input("next@reef.invalid"));
    expect(await claimSetupRequestReceipt(db, next.id, new Date(AT.getTime() + HOUR_MS))).toBe(
      true,
    );
  });

  it("erasure removes receipt state and cancels a claimed row before envelope construction", async () => {
    const db = await unseededTestDb();
    const row = await recordSetupRequest(db, input());
    expect(await claimSetupRequestReceipt(db, row.id, AT)).toBe(true);
    expect(await deleteSetupRequestsByEmail(db, row.email)).toBe(1);
    expect(await readClaimedSetupRequestReceipt(db, row.id)).toBeNull();
    expect(await claimSetupRequestReceipt(db, row.id, AT)).toBe(false);
    await finishSetupRequestReceipt(db, row.id, { status: "unknown", errorCode: "network_error" });
    expect(await db.select().from(setupRequests)).toEqual([]);
  });

  it("refuses invalid state and arbitrary error text at the database boundary", async () => {
    const db = await unseededTestDb();
    await expect(
      db.insert(setupRequests).values({ ...input(), receiptStatus: "retry" as never }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(setupRequests)
        .values({ ...input(), receiptErrorCode: "victim@reef.invalid TOKEN" as never }),
    ).rejects.toThrow();
  });
});
