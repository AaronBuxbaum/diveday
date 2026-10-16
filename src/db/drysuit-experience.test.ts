import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { checkDrysuitCard } from "@/lib/drysuit-card";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createDiver, getDiverProfile } from "./divers";
import { clearDrysuitExperienceSeen, recordDrysuitExperienceSeen } from "./drysuit-experience";
import {
  activityEvents,
  people,
  personRoles,
  rentalFitProfiles,
  specialtyCertifications,
  userAccounts,
} from "./schema";

const ctx = fileScopedShopContext();
const NOTE = "Own DUI shell, three Breakwater shore dives in October";

async function ownerId() {
  const { db, shop } = ctx;
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  if (!staff) throw new Error("seed staff missing");
  return staff.id;
}

/** A live staff account holding exactly these roles. */
async function staffWith(name: string, role: "crew" | "captain" | "divemaster" | "instructor") {
  const { db, shop } = ctx;
  const [row] = await db.insert(people).values({ shopId: shop.id, fullName: name }).returning();
  if (!row) throw new Error("staff insert failed");
  await db.insert(personRoles).values({ personId: row.id, role });
  await db.insert(userAccounts).values({
    personId: row.id,
    email: `${row.id.slice(0, 8)}@example.com`,
    hashedPassword: "x",
    status: "active",
  });
  return row.id;
}

async function dryDiver(name: string, divesDry = true) {
  const { db, shop } = ctx;
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: name,
    email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
  });
  if (!diver) throw new Error("diver insert failed");
  await db.insert(rentalFitProfiles).values({ shopId: shop.id, personId: diver.id, divesDry });
  return diver;
}

const record = (personId: string, byPersonId: string, note = NOTE, now?: Date) =>
  recordDrysuitExperienceSeen(ctx.db, { shopId: ctx.shop.id, personId, byPersonId, note, now });

async function trail(personId: string) {
  return (
    await ctx.db
      .select({ code: activityEvents.code, actor: activityEvents.actorPersonId })
      .from(activityEvents)
      .where(eq(activityEvents.subjectPersonId, personId))
  ).map((row) => row.code);
}

describe("drysuit experience seen (#2136)", () => {
  it("records who, when and what they saw, files a trail line, and the profile names them", async () => {
    const { db, shop } = ctx;
    const diver = await dryDiver("Dry Dana");
    const by = await ownerId();
    const now = new Date("2026-10-01T09:00:00.000Z");

    expect(await record(diver.id, by, `  ${NOTE}  `, now)).toEqual({ ok: true });

    const profile = await getDiverProfile(db, shop.id, diver.id);
    expect(profile?.person.drysuitExperienceSeenAt).toEqual(now);
    expect(profile?.person.drysuitExperienceSeenByPersonId).toBe(by);
    expect(profile?.person.drysuitExperienceSeenNote).toBe(NOTE);
    expect(profile?.drysuitExperienceSeenByName).toBe("Dana Reyes");
    expect(await trail(diver.id)).toEqual(["drysuit_experience_recorded"]);
    expect(
      checkDrysuitCard(
        true,
        profile?.specialtyCertifications ?? [],
        profile?.person.drysuitExperienceSeenAt ?? null,
      ),
    ).toEqual({ status: "ok" });
  });

  it("never creates a card", async () => {
    const { db, shop } = ctx;
    const diver = await dryDiver("Cardless Cal");
    await record(diver.id, await ownerId());
    const cards = await db
      .select({ id: specialtyCertifications.id })
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, diver.id));
    expect(cards).toEqual([]);
    expect((await getDiverProfile(db, shop.id, diver.id))?.specialtyCertifications).toEqual([]);
  });

  /** Domain review A4: instructors, assistant instructors, divemasters, managers, owners. */
  it("refuses a staffer whose live roles do not include a diving lead", async () => {
    const diver = await dryDiver("Roles Rae");
    expect(await record(diver.id, await staffWith("Crew Cy", "crew"))).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await record(diver.id, await staffWith("Captain Cam", "captain"))).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await record(diver.id, await staffWith("DM Dee", "divemaster"))).toEqual({ ok: true });
  });

  it("refuses a demoted account: roles are read live", async () => {
    const { db } = ctx;
    const diver = await dryDiver("Demoted Dot");
    const instructor = await staffWith("Gone Gil", "instructor");
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, instructor));
    expect(await record(diver.id, instructor)).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("requires a short note saying what was seen", async () => {
    const diver = await dryDiver("Noteless Ned");
    const by = await ownerId();
    expect(await record(diver.id, by, "  ")).toEqual({ ok: false, reason: "note_required" });
    expect(await record(diver.id, by, "x".repeat(201))).toEqual({
      ok: false,
      reason: "note_required",
    });
  });

  /** Security review X2: the preconditions live in the writer, not only in the UI. */
  it("refuses a diver who does not dive dry, one with a drysuit card on file, and oneself", async () => {
    const { db, shop } = ctx;
    const by = await ownerId();
    const wet = await dryDiver("Wet Wren", false);
    expect(await record(wet.id, by)).toEqual({ ok: false, reason: "not_recordable" });

    const carded = await dryDiver("Pending Pia");
    await db.insert(specialtyCertifications).values({
      shopId: shop.id,
      personId: carded.id,
      specialty: "drysuit",
      agency: "padi",
      identifier: "DRY-1",
      status: "pending",
    });
    expect(await record(carded.id, by)).toEqual({ ok: false, reason: "not_recordable" });
    // A deleted card is not a card on file: recording is open again.
    await db
      .update(specialtyCertifications)
      .set({ deletedAt: nowDate() })
      .where(eq(specialtyCertifications.personId, carded.id));
    expect(await record(carded.id, by)).toEqual({ ok: true });

    await db.insert(rentalFitProfiles).values({ shopId: shop.id, personId: by, divesDry: true });
    expect(await record(by, by)).toEqual({ ok: false, reason: "self" });
  });

  it("is idempotent: a replay keeps the first date, author and note", async () => {
    const diver = await dryDiver("Replay Rae");
    const by = await ownerId();
    const first = new Date("2026-10-01T09:00:00.000Z");
    await record(diver.id, by, NOTE, first);
    expect(
      await record(diver.id, await staffWith("Late Lou", "instructor"), "later", nowDate()),
    ).toEqual({ ok: false, reason: "already_recorded" });
    const profile = await getDiverProfile(ctx.db, ctx.shop.id, diver.id);
    expect(profile?.person.drysuitExperienceSeenAt).toEqual(first);
    expect(profile?.person.drysuitExperienceSeenByPersonId).toBe(by);
    expect(profile?.person.drysuitExperienceSeenNote).toBe(NOTE);
    expect(await trail(diver.id)).toEqual(["drysuit_experience_recorded"]);
  });

  /** Domain review A5, security review X3: clearing leaves the history, and only some may. */
  it("clears all three halves for the recorder, files a line, and the advisory fires again", async () => {
    const { db, shop } = ctx;
    const diver = await dryDiver("Undo Uma");
    const instructor = await staffWith("Rec Rory", "instructor");
    await record(diver.id, instructor);
    const clear = (byPersonId: string) =>
      clearDrysuitExperienceSeen(db, { shopId: shop.id, personId: diver.id, byPersonId });

    expect(await clear(await staffWith("Other Ola", "instructor"))).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await clear(instructor)).toEqual({ ok: true });
    expect(await clear(instructor)).toEqual({ ok: false, reason: "nothing_to_clear" });

    const profile = await getDiverProfile(db, shop.id, diver.id);
    expect(profile?.person.drysuitExperienceSeenAt).toBeNull();
    expect(profile?.person.drysuitExperienceSeenByPersonId).toBeNull();
    expect(profile?.person.drysuitExperienceSeenNote).toBeNull();
    expect(await trail(diver.id)).toEqual([
      "drysuit_experience_recorded",
      "drysuit_experience_cleared",
    ]);
    expect(checkDrysuitCard(true, [], profile?.person.drysuitExperienceSeenAt ?? null)).toEqual({
      status: "no_card",
    });
  });

  it("lets an owner or manager clear another staffer's recording", async () => {
    const diver = await dryDiver("Owner Ozzy");
    await record(diver.id, await staffWith("Rec Rhea", "divemaster"));
    expect(
      await clearDrysuitExperienceSeen(ctx.db, {
        shopId: ctx.shop.id,
        personId: diver.id,
        byPersonId: await ownerId(),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses another shop's diver, writing nothing", async () => {
    const diver = await dryDiver("Elsewhere Eve");
    const by = await ownerId();
    expect(
      await recordDrysuitExperienceSeen(ctx.db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        personId: diver.id,
        byPersonId: by,
        note: NOTE,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    await record(diver.id, by);
    expect(
      await clearDrysuitExperienceSeen(ctx.db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        personId: diver.id,
        byPersonId: by,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      (await getDiverProfile(ctx.db, ctx.shop.id, diver.id))?.person.drysuitExperienceSeenAt,
    ).not.toBeNull();
  });

  it("is erased with the diver, note included", async () => {
    const { db, shop } = ctx;
    const diver = await dryDiver("Erased Ezra");
    const by = await ownerId();
    await record(diver.id, by);
    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: by });
    const [row] = await db
      .select({
        at: people.drysuitExperienceSeenAt,
        by: people.drysuitExperienceSeenByPersonId,
        note: people.drysuitExperienceSeenNote,
      })
      .from(people)
      .where(eq(people.id, diver.id));
    expect(row).toEqual({ at: null, by: null, note: null });
  });
});
