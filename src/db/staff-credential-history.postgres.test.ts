import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { staffCredentialHistory } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import {
  changeStaffCredential,
  createStaffCredential,
  deleteStaffCredential,
} from "./staff-credentials";
import { listStaff } from "./trips";

describePostgres("staff credential history under contention", () => {
  it("serializes two stale renewals so only one current version and one event win", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [staff] = await listStaff(pg.db, shop.id);
    if (!staff) throw new Error("staff missing");
    const card = await createStaffCredential(pg.db, {
      shopId: shop.id,
      personId: staff.person.id,
      kind: "captains_licence",
      name: "Licence",
      identifier: "RACE-ONE",
      issuedAt: "2024-01-01",
      renewsAt: "2026-01-01",
    });
    if (!card) throw new Error("card missing");
    const gate = await holdRowLock(
      pg,
      sql`select id from staff_credentials where id = ${card.id} for update`,
    );
    const input = {
      shopId: shop.id,
      personId: card.personId,
      credentialId: card.id,
      expectedRevision: card.revision,
      kind: card.kind,
      name: card.name,
      identifier: card.identifier,
      issuingBody: card.issuingBody,
      issuedAt: "2026-02-01",
      renewsAt: "2028-02-01",
      change: "renewed" as const,
    };
    const first = changeStaffCredential(pg.connect(), input);
    const second = changeStaffCredential(pg.connect(), {
      ...input,
      issuedAt: "2026-03-01",
      renewsAt: "2028-03-01",
    });
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    const result = await Promise.all([first, second]);
    expect(result.filter(Boolean)).toHaveLength(1);
    const history = await pg.db
      .select()
      .from(staffCredentialHistory)
      .where(eq(staffCredentialHistory.credentialId, card.id));
    expect(history.map((event) => event.event).sort()).toEqual(["created", "renewed"]);
  });

  it("a stale delete cannot erase a concurrently corrected credential", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [staff] = await listStaff(pg.db, shop.id);
    if (!staff) throw new Error("staff missing");
    const card = await createStaffCredential(pg.db, {
      shopId: shop.id,
      personId: staff.person.id,
      kind: "captains_licence",
      name: "Licence",
      identifier: "RACE-TWO",
      issuedAt: "2024-01-01",
      renewsAt: "2026-01-01",
    });
    if (!card) throw new Error("card missing");
    const fixed = await changeStaffCredential(pg.db, {
      shopId: shop.id,
      personId: card.personId,
      credentialId: card.id,
      expectedRevision: card.revision,
      kind: card.kind,
      name: "Corrected licence",
      identifier: card.identifier,
      issuingBody: card.issuingBody,
      issuedAt: card.issuedAt,
      renewsAt: card.renewsAt,
      change: "corrected",
    });
    expect(fixed?.revision).toBe(card.revision + 1);
    expect(
      await deleteStaffCredential(pg.connect(), shop.id, card.id, staff.person.id, card.revision),
    ).toBe(false);
  });
});
