import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getAccountSecurityPage } from "@/db/account-security";
import { people } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { seededStaffPersonId, staffSession } from "@/test/staff-session";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("../../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));
const { requireShopSurface } = await import("../../../../../features/session/rules");
const { saveStaffProfileAction } = await import("./staff-profile-actions");
const { saveCrewPublicConsentAction } = await import("./profile-actions");
const ctx = fileScopedShopContext();

async function captain() {
  const { db, shop } = ctx;
  const personId = await seededStaffPersonId(db, shop.id, "sal@demo.invalid");
  vi.mocked(requireShopSurface).mockResolvedValue({
    db,
    shop,
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["captain"] }),
  } as never);
  return personId;
}
function form(personId: string, consent = true) {
  const data = new FormData();
  data.set("personId", personId);
  data.set("publicName", "Sal Public");
  if (consent) data.set("consented", "on");
  return data;
}

describe("account public profile", () => {
  it("lets ordinary staff save and withdraw their own consent at Account settings", async () => {
    const id = await captain();
    await expect(saveCrewPublicConsentAction(ctx.shop.slug, form(id))).rejects.toThrow(
      `/me/security?notice=crew-consent-saved`,
    );
    let [person] = await ctx.db.select().from(people).where(eq(people.id, id));
    expect(person?.crewPublicName).toBe("Sal Public");
    expect(person?.crewPublicConsentAt).not.toBeNull();
    await expect(saveCrewPublicConsentAction(ctx.shop.slug, form(id, false))).rejects.toThrow(
      `/me/security?notice=crew-consent-withdrawn`,
    );
    [person] = await ctx.db.select().from(people).where(eq(people.id, id));
    expect(person?.crewPublicConsentAt).toBeNull();
  });
  it("refuses posting another person's consent", async () => {
    await captain();
    const other = await seededStaffPersonId(ctx.db, ctx.shop.id, "dana@demo.invalid");
    const [before] = await ctx.db.select().from(people).where(eq(people.id, other));
    await expect(saveCrewPublicConsentAction(ctx.shop.slug, form(other))).rejects.toThrow(
      `/me/security?notice=invalid`,
    );
    const [after] = await ctx.db.select().from(people).where(eq(people.id, other));
    expect(after?.crewPublicConsentAt).toEqual(before?.crewPublicConsentAt);
    expect(after?.crewPublicName).toEqual(before?.crewPublicName);
  });
  it("does not read an account profile through another shop", async () => {
    const id = await captain();
    expect(
      await getAccountSecurityPage(ctx.db, id, "11111111-1111-4111-8111-111111111111"),
    ).toBeNull();
  });
});

function profileForm(personId: string, enabled = true) {
  const data = new FormData();
  data.set("personId", personId);
  if (enabled) data.set("profileEnabled", "on");
  data.set("profileFirstName", "Sal");
  data.set("profileRole", "Captain");
  data.set("profileLanguages", "English");
  data.set("profileDescription", "I like the early reef.");
  return data;
}
describe("self-authored staff introductions", () => {
  it("allows an ordinary staff member to publish and withdraw a separate profile", async () => {
    const id = await captain();
    await expect(saveStaffProfileAction(ctx.shop.slug, profileForm(id))).rejects.toThrow(
      "staff-profile-saved",
    );
    let [person] = await ctx.db.select().from(people).where(eq(people.id, id));
    expect(person?.publicStaffProfileEnabled).toBe(true);
    expect(person?.publicStaffProfile?.description).toBe("I like the early reef.");
    expect(person?.crewPublicConsentAt).toBeNull();
    await expect(saveStaffProfileAction(ctx.shop.slug, profileForm(id, false))).rejects.toThrow(
      "staff-profile-withdrawn",
    );
    [person] = await ctx.db.select().from(people).where(eq(people.id, id));
    expect(person?.publicStaffProfileEnabled).toBe(false);
    expect(person?.publicStaffProfile).toBeNull();
  });
  it("refuses another person's edit and ignores arbitrary photo URLs", async () => {
    const id = await captain();
    const other = await seededStaffPersonId(ctx.db, ctx.shop.id, "dana@demo.invalid");
    await expect(saveStaffProfileAction(ctx.shop.slug, profileForm(other))).rejects.toThrow(
      "notice=invalid",
    );
    const data = profileForm(id);
    data.set("photoUrls", "https://other.invalid/private.jpg");
    await expect(saveStaffProfileAction(ctx.shop.slug, data)).rejects.toThrow(
      "staff-profile-saved",
    );
    const [person] = await ctx.db.select().from(people).where(eq(people.id, id));
    expect(person?.publicStaffProfile?.photoUrls).toEqual([]);
  });
});
