import { describe, expect, it, vi } from "vitest";
import { listBoats } from "@/db/boats";
import { listTripLenses } from "@/db/trip-lenses";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **Each register carries its own gate** (issue #2659, glossary "Register and
 * setting"). Boats and trip tags left Settings, so their writes no longer
 * borrow `settingsBlock`; they ask `canManageBoats` and `canManageTripTags`.
 * The page hides the forms from a captain, and a hidden form is not a gate:
 * these run the real actions against a seeded database and read the register
 * back after the refusal, because the setters write whatever they are handed.
 */

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
const { createBoatAction, deleteBoatAction, updateBoatAction } = await import("./boats/actions");
const { createTripLensAction } = await import("./trip-tags/actions");

async function signedInAs(email: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, email);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { db, shop };
}

function boatForm(name: string) {
  const form = new FormData();
  form.set("name", name);
  form.set("capacity", "10");
  return form;
}

describe("the boats register's gate", () => {
  it.each([
    { field: "workingChannel", value: "16", notice: "boat-channel-distress" },
    { field: "mmsi", value: "123", notice: "boat-radio-invalid" },
    { field: "capacity", value: "0", notice: "boat-invalid" },
  ])(
    "returns a refused $field creation to the new boat editor",
    async ({ field, value, notice }) => {
      const { db, shop } = await signedInAs(SEEDED_OWNER_EMAIL);
      const before = await listBoats(db, shop.id);
      const form = boatForm("Second Wind");
      form.set(field, value);

      const to = new URL(
        await redirectedTo(() => createBoatAction(form)),
        "https://diveday.example",
      );
      expect(to.searchParams.get("notice")).toBe(notice);
      expect(to.searchParams.get("boat")).toBe("new");
      expect(to.hash).toBe("#boat-new");
      expect(await listBoats(db, shop.id)).toEqual(before);
    },
  );

  it.each([
    { field: "workingChannel", value: "16", notice: "boat-channel-distress" },
    { field: "mmsi", value: "123", notice: "boat-radio-invalid" },
    { field: "capacity", value: "0", notice: "boat-invalid" },
  ])("returns a refused $field edit to its own boat editor", async ({ field, value, notice }) => {
    const { db, shop } = await signedInAs(SEEDED_OWNER_EMAIL);
    const before = await listBoats(db, shop.id);
    const boat = before[0];
    if (!boat) throw new Error("seed boat missing");
    const form = boatForm(boat.name);
    form.set("boatId", boat.id);
    form.set(field, value);

    const to = new URL(await redirectedTo(() => updateBoatAction(form)), "https://diveday.example");
    expect(to.searchParams.get("notice")).toBe(notice);
    expect(to.searchParams.get("boat")).toBe(boat.id);
    expect(to.hash).toBe(`#boat-${boat.id}`);
    expect(await listBoats(db, shop.id)).toEqual(before);
  });

  it("refuses a captain's hand-made post and leaves the fleet as it was", async () => {
    const { db, shop } = await signedInAs(SEEDED_CAPTAIN_EMAIL);
    const before = await listBoats(db, shop.id);

    expect(await redirectedTo(() => createBoatAction(boatForm("Captain's Folly")))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );
    const target = new FormData();
    target.set("boatId", before[0]?.id ?? "");
    expect(await redirectedTo(() => deleteBoatAction(target))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    expect((await listBoats(db, shop.id)).map((boat) => boat.id)).toEqual(
      before.map((boat) => boat.id),
    );
  });

  it("lets the owner add a boat and lands back on the register's own address", async () => {
    const { db, shop } = await signedInAs(SEEDED_OWNER_EMAIL);

    expect(await redirectedTo(() => createBoatAction(boatForm("Second Wind")))).toBe(
      `/shop/${shop.slug}/boats?notice=boat-created`,
    );
    expect((await listBoats(db, shop.id)).map((boat) => boat.name)).toContain("Second Wind");
  });
});

describe("the trip tags register's gate", () => {
  it("refuses a captain's hand-made post and leaves the tags as they were", async () => {
    const { db, shop } = await signedInAs(SEEDED_CAPTAIN_EMAIL);
    const before = await listTripLenses(db, shop.id);

    const form = new FormData();
    form.set("name", "Captain's tag");
    expect(await redirectedTo(() => createTripLensAction(form))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    expect(await listTripLenses(db, shop.id)).toHaveLength(before.length);
  });

  it("lets the owner add a tag and lands back on the register's own address", async () => {
    const { db, shop } = await signedInAs(SEEDED_OWNER_EMAIL);
    const form = new FormData();
    form.set("name", "After dark");

    expect(await redirectedTo(() => createTripLensAction(form))).toBe(
      `/shop/${shop.slug}/trip-tags?notice=lens-created`,
    );
    expect((await listTripLenses(db, shop.id)).map((lens) => lens.name)).toContain("After dark");
  });
});
