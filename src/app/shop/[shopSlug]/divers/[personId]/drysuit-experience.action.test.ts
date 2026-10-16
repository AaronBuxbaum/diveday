import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { mergeDiverRecords } from "@/db/diver-merge";
import { createDiver } from "@/db/divers";
import { people, rentalFitProfiles, userAccounts } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

/**
 * **"Seen diving dry" through the diver record's own actions** (security
 * review X4): the URL, the session and the form are all a replay can choose,
 * so each is tried here and the row read back.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { recordDrysuitExperienceAction } = await import("./card-actions");

const ctx = fileScopedShopContext();

async function setUp(name: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner, roles: ["owner"] }),
  );
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: name,
    email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
  });
  if (!diver) throw new Error("diver insert failed");
  await db
    .insert(rentalFitProfiles)
    .values({ shopId: shop.id, personId: diver.id, divesDry: true });
  return { db, shop, owner, personId: diver.id };
}

function note(text: string) {
  const formData = new FormData();
  formData.set("note", text);
  return formData;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a redirect");
}

async function seenAt(personId: string) {
  const [row] = await ctx.db
    .select({ at: people.drysuitExperienceSeenAt })
    .from(people)
    .where(eq(people.id, personId));
  return row?.at ?? null;
}

describe("recordDrysuitExperienceAction", () => {
  it("records with a note, and refuses a blank one writing nothing", async () => {
    const { shop, personId } = await setUp("Action Ava");
    expect(
      await redirectedTo(() => recordDrysuitExperienceAction(shop.slug, personId, note("  "))),
    ).toContain("drysuit-experience-note-required");
    expect(await seenAt(personId)).toBeNull();
    expect(
      await redirectedTo(() =>
        recordDrysuitExperienceAction(shop.slug, personId, note("Own drysuit, shore dive")),
      ),
    ).toContain("drysuit-experience-recorded");
    expect(await seenAt(personId)).not.toBeNull();
  });

  it("is a 404 for a malformed id", async () => {
    const { shop } = await setUp("Malformed Mo");
    expect(
      await redirectedTo(() => recordDrysuitExperienceAction(shop.slug, "not-a-uuid", note("x"))),
    ).toBe("NOT_FOUND");
  });

  it("sends a demoted account back without writing", async () => {
    const { db, shop, owner, personId } = await setUp("Demoted Dee");
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, owner));
    try {
      expect(
        await redirectedTo(() =>
          recordDrysuitExperienceAction(shop.slug, personId, note("Saw it")),
        ),
      ).toContain("not-authorized-cards");
      expect(await seenAt(personId)).toBeNull();
    } finally {
      await db
        .update(userAccounts)
        .set({ status: "active" })
        .where(eq(userAccounts.personId, owner));
    }
  });

  it("sends a merged-away id to the kept record without writing", async () => {
    const { db, shop, owner, personId } = await setUp("Merged Max");
    const kept = await setUp("Kept Kai");
    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId,
      survivorId: kept.personId,
      actorPersonId: owner,
    });
    expect(
      await redirectedTo(() => recordDrysuitExperienceAction(shop.slug, personId, note("Saw it"))),
    ).toContain("merged-record-moved");
    expect(await seenAt(kept.personId)).toBeNull();
  });
});
