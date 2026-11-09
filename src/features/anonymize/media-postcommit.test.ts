import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { queueMediaDeletion } from "@/db/media-deletions";
import { mediaDeletionAttempts, people, personRoles } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { ANONYMIZED_PERSON_NAME } from "../anonymization/rules";
import { createDiver } from "../divers/store";
import { anonymizeDiver } from "./store";

const ctx = fileScopedShopContext();
it("attempts all-version media erasure after local redaction commits", async () => {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")));
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Media Erasure" })
    .returning();
  if (!owner || !person) throw new Error("missing fixture");
  await queueMediaDeletion(db, {
    shopId: shop.id,
    personId: person.id,
    kind: "recap_photo",
    url: "https://diveday-media.s3.us-east-1.amazonaws.com/recap/retired.jpg",
  });
  const mediaDeleteFn = vi.fn(async (_url: string, purgeVersions?: boolean) => {
    expect(purgeVersions).toBe(true);
    const [erased] = await db.select().from(people).where(eq(people.id, person.id));
    expect(erased?.anonymizedAt).not.toBeNull();
    return { ok: true as const };
  });
  expect(
    await anonymizeDiver(
      db,
      { shopId: shop.id, personId: person.id, actorPersonId: owner.id },
      { mediaDeleteFn },
    ),
  ).toMatchObject({ ok: true, owedMediaDeletions: 0 });
  expect(mediaDeleteFn).toHaveBeenCalledTimes(1);
  const rows = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(eq(mediaDeletionAttempts.personId, person.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ purgeVersions: true, status: "succeeded" });
});

it("retries outstanding media on an erased replay until recovery succeeds", async () => {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")));
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Retry Erasure" })
    .returning();
  if (!owner || !person) throw new Error("missing fixture");
  await queueMediaDeletion(db, {
    shopId: shop.id,
    personId: person.id,
    kind: "recap_photo",
    url: "https://diveday-media.s3.us-east-1.amazonaws.com/recap/retry.jpg",
  });
  const input = { shopId: shop.id, personId: person.id, actorPersonId: owner.id };
  const mediaDeleteFn = vi.fn(async () => ({ ok: false as const, error: "outage" }));
  expect(await anonymizeDiver(db, input, { mediaDeleteFn })).toMatchObject({
    ok: true,
    owedMediaDeletions: 1,
  });
  expect(await anonymizeDiver(db, input, { mediaDeleteFn })).toMatchObject({
    ok: true,
    alreadyAnonymized: true,
    queuedMediaDeletions: 0,
    owedMediaDeletions: 1,
  });
  expect(mediaDeleteFn).toHaveBeenCalledTimes(2);
  const recovered = vi.fn(async () => ({ ok: true as const }));
  expect(await anonymizeDiver(db, input, { mediaDeleteFn: recovered })).toMatchObject({
    ok: true,
    owedMediaDeletions: 0,
  });
  expect(recovered).toHaveBeenCalledTimes(1);
  await anonymizeDiver(db, input, { mediaDeleteFn: recovered });
  expect(recovered).toHaveBeenCalledTimes(1);
});

it("erases a diver who has nothing but a name", async () => {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")));
  if (!owner) throw new Error("missing owner");
  const ownerId = owner.id;
  const diver = await createDiver(db, { shopId: shop.id, fullName: "Bare Bernard" });
  if (!diver) throw new Error("diver insert failed");

  expect(
    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: ownerId }),
  ).toEqual({
    ok: true,
    alreadyAnonymized: false,
    queuedMediaDeletions: 0,
    owedMediaDeletions: 0,
    dischargedProcessorErasures: 0,
    owedProcessorErasures: 0,
  });
  const [person] = await db.select().from(people).where(eq(people.id, diver.id));
  expect(person).toMatchObject({ fullName: ANONYMIZED_PERSON_NAME, email: null });
  expect(person?.anonymizedAt).toBeInstanceOf(Date);
});
