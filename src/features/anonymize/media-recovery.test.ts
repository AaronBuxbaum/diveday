import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { mediaDeletionAttempts, people, personRoles } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./store";

const fileCtx = fileScopedShopContext({ history: true });
const MANAGED_BLOB_HOST = "https://diveday-media.s3.us-east-1.amazonaws.com";
async function erasureFixtures() {
  const { db, shop } = fileCtx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("missing owner fixture");
  return { db, shop, owner };
}

describe("erasure of recoverable detached media", () => {
  it("purges prior replaced versions even when the current record no longer references their URL", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [diver, other] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Erased diver" },
        { shopId: shop.id, fullName: "Other diver" },
      ])
      .returning();
    const url = `${MANAGED_BLOB_HOST}/medical-clearances/replaced.pdf`;
    const [prior, unrelated] = await db
      .insert(mediaDeletionAttempts)
      .values([
        {
          shopId: shop.id,
          personId: diver.id,
          kind: "waiver_document",
          url,
          purgeVersions: false,
          status: "succeeded",
          resolvedAt: new Date("2026-11-09T00:00:00Z"),
        },
        {
          shopId: shop.id,
          personId: other.id,
          kind: "waiver_document",
          url: `${MANAGED_BLOB_HOST}/medical-clearances/other.pdf`,
          purgeVersions: false,
          status: "succeeded",
          resolvedAt: new Date("2026-11-09T00:00:00Z"),
        },
      ])
      .returning();
    const remove = vi.fn(async () => ({ ok: true as const }));
    const result = await anonymizeDiver(
      db,
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { mediaDeleteFn: remove },
    );
    expect(result).toMatchObject({ ok: true, owedMediaDeletions: 0 });
    expect(remove).toHaveBeenCalledWith(url, true);
    const rows = await db
      .select()
      .from(mediaDeletionAttempts)
      .where(inArray(mediaDeletionAttempts.id, [prior.id, unrelated.id]));
    expect(rows.find((row) => row.id === prior.id)).toMatchObject({
      purgeVersions: true,
      status: "succeeded",
    });
    expect(rows.find((row) => row.id === unrelated.id)).toMatchObject({
      purgeVersions: false,
      status: "succeeded",
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
