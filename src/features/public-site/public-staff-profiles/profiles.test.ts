import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { mediaDeletionAttempts, people, shops, userAccounts } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { seededStaffPersonId } from "@/test/staff-session";
import { listPublicStaffProfiles, writeOwnStaffProfile } from "./profiles";

const ctx = fileScopedShopContext();
const profile = {
  firstName: "Sal",
  role: "Captain",
  sinceYear: 2014,
  languages: "English, Español",
  description: "I love a quiet morning on the reef.",
  photoUrls: [],
};
describe("optional public staff profiles", () => {
  it("never upgrades name-only consent; publishes only a separately opted-in profile", async () => {
    const id = await seededStaffPersonId(ctx.db, ctx.shop.id, "sal@demo.invalid");
    await ctx.db
      .update(people)
      .set({ crewPublicName: "Sal", crewPublicConsentAt: new Date("2026-01-01") })
      .where(eq(people.id, id));
    expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([]);
    expect(
      await writeOwnStaffProfile(ctx.db, {
        shopId: ctx.shop.id,
        personId: id,
        actorPersonId: id,
        enabled: true,
        profile,
      }),
    ).toBe(true);
    expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([profile]);
    await writeOwnStaffProfile(ctx.db, {
      shopId: ctx.shop.id,
      personId: id,
      actorPersonId: id,
      enabled: false,
      profile: null,
    });
    expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([]);
  });
  it("refuses editing another person or crossing a tenant", async () => {
    const id = await seededStaffPersonId(ctx.db, ctx.shop.id, "sal@demo.invalid");
    const other = await seededStaffPersonId(ctx.db, ctx.shop.id, "dana@demo.invalid");
    expect(
      await writeOwnStaffProfile(ctx.db, {
        shopId: ctx.shop.id,
        personId: id,
        actorPersonId: other,
        enabled: true,
        profile,
      }),
    ).toBe(false);
    expect(
      await writeOwnStaffProfile(ctx.db, {
        shopId: "11111111-1111-4111-8111-111111111111",
        personId: id,
        actorPersonId: id,
        enabled: true,
        profile,
      }),
    ).toBe(false);
    expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([]);
  });
  it("hides disabled staff immediately and never exposes account or person identifiers", async () => {
    const id = await seededStaffPersonId(ctx.db, ctx.shop.id, "sal@demo.invalid");
    await writeOwnStaffProfile(ctx.db, {
      shopId: ctx.shop.id,
      personId: id,
      actorPersonId: id,
      enabled: true,
      profile,
    });
    expect(JSON.stringify(await listPublicStaffProfiles(ctx.db, ctx.shop.id))).not.toContain(id);
    await ctx.db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, id));
    expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([]);
  });
});

it("the shop kill switch hides all introductions without withdrawing the person's choice", async () => {
  const id = await seededStaffPersonId(ctx.db, ctx.shop.id, "sal@demo.invalid");
  await writeOwnStaffProfile(ctx.db, {
    shopId: ctx.shop.id,
    personId: id,
    actorPersonId: id,
    enabled: true,
    profile,
  });
  await ctx.db
    .update(shops)
    .set({ publicStaffProfilesEnabled: false })
    .where(eq(shops.id, ctx.shop.id));
  expect(await listPublicStaffProfiles(ctx.db, ctx.shop.id)).toEqual([]);
  const [person] = await ctx.db.select().from(people).where(eq(people.id, id));
  expect(person?.publicStaffProfileEnabled).toBe(true);
});
it("withdrawal clears authored content and durably retires every owned picture", async () => {
  vi.stubEnv("MEDIA_BUCKET_NAME", "diveday-media");
  vi.stubEnv("MEDIA_AWS_REGION", "us-east-1");
  try {
    const id = await seededStaffPersonId(ctx.db, ctx.shop.id, "sal@demo.invalid");
    const photo = "https://diveday-media.s3.us-east-1.amazonaws.com/staff-profiles/picture.jpg";
    await writeOwnStaffProfile(ctx.db, {
      shopId: ctx.shop.id,
      personId: id,
      actorPersonId: id,
      enabled: true,
      profile: { ...profile, photoUrls: [photo] },
    });
    await writeOwnStaffProfile(ctx.db, {
      shopId: ctx.shop.id,
      personId: id,
      actorPersonId: id,
      enabled: false,
      profile: null,
    });
    const [job] = await ctx.db
      .select()
      .from(mediaDeletionAttempts)
      .where(eq(mediaDeletionAttempts.personId, id));
    expect(job).toMatchObject({
      shopId: ctx.shop.id,
      personId: id,
      url: photo,
      kind: "staff_profile",
    });
    const [person] = await ctx.db.select().from(people).where(eq(people.id, id));
    expect(person?.publicStaffProfile).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});
