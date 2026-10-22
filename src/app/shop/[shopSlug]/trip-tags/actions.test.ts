import { describe, expect, it, vi } from "vitest";
import { listTripLenses } from "@/db/trip-lenses";
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
const { createTripLensAction, updateTripLensAction } = await import("./actions");

async function signedInAs(email: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, email);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { db, shop };
}

describe("trip-tag refusal destinations", () => {
  it("returns a whitespace rename to that tag's editor without changing any tag", async () => {
    const { db, shop } = await signedInAs(SEEDED_OWNER_EMAIL);
    const before = await listTripLenses(db, shop.id);
    const lens = before[0];
    if (!lens) throw new Error("seed tag missing");
    const form = new FormData();
    form.set("lensId", lens.id);
    form.set("name", "   ");

    const to = new URL(
      await redirectedTo(() => updateTripLensAction(form)),
      "https://diveday.example",
    );
    expect(to.searchParams.get("notice")).toBe("lens-invalid");
    expect(to.searchParams.get("lens")).toBe(lens.id);
    expect(to.hash).toBe(`#tag-${lens.id}`);
    expect(await listTripLenses(db, shop.id)).toEqual(before);
  });

  it("returns a whitespace creation to the new-tag editor without adding a tag", async () => {
    const { db, shop } = await signedInAs(SEEDED_OWNER_EMAIL);
    const before = await listTripLenses(db, shop.id);
    const form = new FormData();
    form.set("name", "   ");

    const to = new URL(
      await redirectedTo(() => createTripLensAction(form)),
      "https://diveday.example",
    );
    expect(to.searchParams.get("notice")).toBe("lens-invalid");
    expect(to.searchParams.get("lens")).toBe("new");
    expect(to.hash).toBe("#tag-new");
    expect(await listTripLenses(db, shop.id)).toEqual(before);
  });

  it.each(["new", "bad#tag-new", "", "not-a-uuid"])(
    "never reflects malformed update id %j into an editor destination",
    async (id) => {
      const { db, shop } = await signedInAs(SEEDED_OWNER_EMAIL);
      const before = await listTripLenses(db, shop.id);
      const form = new FormData();
      form.set("lensId", id);
      form.set("name", "Renamed");

      const to = new URL(
        await redirectedTo(() => updateTripLensAction(form)),
        "https://diveday.example",
      );
      expect(to.searchParams.get("notice")).toBe("lens-invalid");
      expect(to.searchParams.get("lens")).toBeNull();
      expect(to.hash).toBe("");
      expect(await listTripLenses(db, shop.id)).toEqual(before);
    },
  );

  it("refuses a captain before routing validation back to a tag editor", async () => {
    const { db, shop } = await signedInAs(SEEDED_CAPTAIN_EMAIL);
    const before = await listTripLenses(db, shop.id);
    const form = new FormData();
    form.set("lensId", before[0]?.id ?? "");
    form.set("name", "   ");

    expect(await redirectedTo(() => updateTripLensAction(form))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );
    expect(await listTripLenses(db, shop.id)).toEqual(before);
  });
});
