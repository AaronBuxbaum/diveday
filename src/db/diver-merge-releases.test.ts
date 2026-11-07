import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { mintCapability } from "./capabilities";
import { mergeDiverRecords } from "./diver-merge";
import { capabilities, people, personRoles, waiverRecords } from "./schema";
import { waiverLinkDoor } from "./waivers-completion";
import { getCurrentWaiverTemplate } from "./waivers-templates";

/**
 * **A merge leaves one door per unsigned release** (issue #4020, point 1).
 * Signed, a release with no seat covers every seat its diver holds, so two
 * unsigned ones, each with a live link, would each be a way to sign for all of
 * them. The release moved off the merged-away record is set aside, and the
 * links to it open nothing; the survivor's own release, a signed release and a
 * release on a seat are none of that.
 */
const ctx = fileScopedShopContext();

async function mergeFixtures() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("merge fixture needs the seeded owner");
  const [source, survivor] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" },
      // The same phone on both, so the merge changes no contact and revokes no link of its own.
      {
        shopId: shop.id,
        fullName: "Maya Rivera",
        email: "maya@example.com",
        phone: "+1 (305) 555-0142",
      },
    ])
    .returning();
  if (!source || !survivor) throw new Error("merge fixture people insert failed");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  return { owner, source, survivor };
}

/** An unsigned release with no seat (or a signed one), and both kinds of door to it. */
async function release(personId: string, status: "pending" | "completed" = "pending") {
  const { db, shop } = ctx;
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!template) throw new Error("expected a seeded waiver template");
  const [row] = await db
    .insert(waiverRecords)
    .values({
      shopId: shop.id,
      personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      templateGeneration: template.materialGeneration,
      status,
      ...(status === "completed"
        ? {
            signedName: "Maya Rivera",
            signatureMethod: "typed" as const,
            consentedAt: nowDate(),
            signedAt: nowDate(),
            completedAt: nowDate(),
          }
        : {}),
    })
    .returning();
  if (!row) throw new Error("release insert failed");
  const doors: string[] = [];
  for (const purpose of ["waiver_link", "release_link"] as const) {
    const minted = await mintCapability(db, {
      purpose,
      shopId: shop.id,
      subjectId: row.id,
      expiresAt: new Date(nowDate().getTime() + DAY_MS),
    });
    doors.push(minted.token);
  }
  return { id: row.id, doors };
}

async function merge(f: Awaited<ReturnType<typeof mergeFixtures>>) {
  await mergeDiverRecords({
    db: ctx.db,
    shopId: ctx.shop.id,
    personId: f.source.id,
    survivorId: f.survivor.id,
    actorPersonId: f.owner.id,
  });
}

async function supersededAt(id: string) {
  const [row] = await ctx.db
    .select({ supersededAt: waiverRecords.supersededAt, personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(eq(waiverRecords.id, id));
  if (!row) throw new Error("release vanished");
  return row;
}

describe("merging two divers who each hold an unsigned release", () => {
  it("sets aside the moved release, so no link to it opens, and keeps the survivor's own", async () => {
    const f = await mergeFixtures();
    const moved = await release(f.source.id);
    const own = await release(f.survivor.id);

    await merge(f);

    const after = await supersededAt(moved.id);
    expect(after.personId).toBe(f.survivor.id);
    expect(after.supersededAt).not.toBeNull();
    for (const token of moved.doors) expect(await waiverLinkDoor(ctx.db, token)).toBeNull();

    expect((await supersededAt(own.id)).supersededAt).toBeNull();
    for (const token of own.doors) expect(await waiverLinkDoor(ctx.db, token)).not.toBeNull();
  });

  it("leaves the survivor exactly one release with a live door", async () => {
    const f = await mergeFixtures();
    const moved = await release(f.source.id);
    const own = await release(f.survivor.id);

    await merge(f);

    const live = await ctx.db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.personId, f.survivor.id),
          eq(waiverRecords.status, "pending"),
          eq(waiverRecords.shopId, ctx.shop.id),
        ),
      );
    expect(live.map((row) => row.id).sort()).toEqual([moved.id, own.id].sort());
    const open = [];
    for (const row of [moved, own]) {
      for (const token of row.doors) {
        if (await waiverLinkDoor(ctx.db, token)) open.push(row.id);
      }
    }
    expect(new Set(open)).toEqual(new Set([own.id]));
  });

  it("does not touch a signed release it moves", async () => {
    const f = await mergeFixtures();
    const signed = await release(f.source.id, "completed");

    await merge(f);

    const after = await supersededAt(signed.id);
    expect(after.personId).toBe(f.survivor.id);
    expect(after.supersededAt).toBeNull();
  });

  it("revokes nothing on a survivor's release it did not move", async () => {
    const f = await mergeFixtures();
    await release(f.source.id);
    const own = await release(f.survivor.id);

    await merge(f);

    const links = await ctx.db
      .select({ revokedAt: capabilities.revokedAt })
      .from(capabilities)
      .where(eq(capabilities.waiverRecordId, own.id));
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.revokedAt === null)).toBe(true);
  });
});
