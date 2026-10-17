import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { staffCredentials } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { saveStaffCredentialAction } = await import("./actions");

/**
 * Issue #2172: a pro rating with no renewal date reads as current, so one old
 * undated card kept a lapsed pro counted toward supervision. A rating is
 * added with its date or not at all; every other kind stays optional.
 */
async function setup() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  return { db, shop, captain };
}

function credentialForm(personId: string, kind: string, renewsAt: string): FormData {
  const form = new FormData();
  form.set("personId", personId);
  form.set("kind", kind);
  form.set("name", "Old card");
  form.set("issuingBody", "");
  form.set("identifier", "");
  form.set("issuedAt", "");
  form.set("renewsAt", renewsAt);
  return form;
}

async function savedFor(personId: string) {
  return ctx.db.select().from(staffCredentials).where(eq(staffCredentials.personId, personId));
}

describe("adding a staff credential", () => {
  for (const kind of ["instructor_rating", "divemaster_rating"]) {
    it(`refuses an undated ${kind}, and writes nothing`, async () => {
      const { shop, captain } = await setup();
      const to = await redirectedTo(() =>
        saveStaffCredentialAction(credentialForm(captain, kind, "")),
      );
      expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=credential-renewal-required`);
      expect(await savedFor(captain)).toEqual([]);
    });

    it(`saves a dated ${kind}`, async () => {
      const { shop, captain } = await setup();
      const to = await redirectedTo(() =>
        saveStaffCredentialAction(credentialForm(captain, kind, "2031-03-01")),
      );
      expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=credential-saved`);
      expect(await savedFor(captain)).toHaveLength(1);
    });
  }

  it("still saves the other kinds without a renewal date", async () => {
    const { shop, captain } = await setup();
    for (const kind of [
      "assistant_instructor_rating",
      "first_aid_cpr",
      "captains_licence",
      "other",
    ]) {
      const to = await redirectedTo(() =>
        saveStaffCredentialAction(credentialForm(captain, kind, "")),
      );
      expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=credential-saved`);
    }
    expect(await savedFor(captain)).toHaveLength(4);
  });
});
