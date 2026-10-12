import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The new-diver form's action. It was an inline closure in `page.tsx` that no
 * test could import (2026-10-11 review, item 34); these pin its doors: where a
 * refusal and a name match send the staffer back to, and which write each door
 * hands the form on to.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/app/actions/seat-diver", () => ({ seatNewDiverAction: vi.fn() }));
vi.mock("@/app/shop/[shopSlug]/trips/[id]/actions", () => ({ addToWaitlistAction: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/db/divers", () => ({ createDiver: vi.fn(), findSimilarDivers: vi.fn() }));
vi.mock("@/db/form-drafts", () => ({ discardFormDraft: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { seatNewDiverAction } = await import("@/app/actions/seat-diver");
const { addToWaitlistAction } = await import("@/app/shop/[shopSlug]/trips/[id]/actions");
const { createDiver, findSimilarDivers } = await import("@/db/divers");
const { discardFormDraft } = await import("@/db/form-drafts");
const { revalidateAndRedirect } = await import("@/lib/navigation");
const { requireStaffSession } = await import("@/lib/session");
const { createDiverFormAction } = await import("./actions");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const DIVER_ID = "44444444-4444-4444-8444-444444444444";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Where the action sent the staffer, or `null` when it handed the form on. */
async function landing(fields: Record<string, string>): Promise<string | null> {
  try {
    await createDiverFormAction(form(fields));
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
}

beforeEach(() => {
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: "staff" },
  } as never);
  vi.mocked(findSimilarDivers).mockResolvedValue([]);
  vi.mocked(createDiver).mockResolvedValue({ id: DIVER_ID } as never);
});

afterEach(() => vi.clearAllMocks());

describe("createDiverFormAction", () => {
  it("creates the diver in the session's shop and opens their record to finish it", async () => {
    expect(await landing({ fullName: "Nadia Ruiz", email: "nadia@example.com", phone: "" })).toBe(
      `/shop/blue-mantis/divers/${DIVER_ID}?edit=1`,
    );
    expect(createDiver).toHaveBeenCalledWith(
      { db: "handle" },
      expect.objectContaining({ shopId: SHOP_ID, fullName: "Nadia Ruiz" }),
    );
    expect(revalidateAndRedirect).toHaveBeenCalledWith(
      "/shop/blue-mantis/divers",
      `/shop/blue-mantis/divers/${DIVER_ID}?edit=1`,
    );
    // The form was accepted, so its kept draft is finished with.
    expect(discardFormDraft).toHaveBeenCalledWith({ db: "handle" }, SHOP_ID, "staff", "new_diver");
  });

  it("sends an empty form back with its door kept, and writes nothing", async () => {
    expect(
      await landing({
        fullName: "",
        email: "",
        phone: "",
        surface: "trip-guests",
        tripId: TRIP_ID,
        waitlist: "true",
      }),
    ).toBe(
      `/shop/blue-mantis/divers/new?notice=invalid&surface=trip-guests&tripId=${TRIP_ID}&waitlist=true`,
    );
    expect(createDiver).not.toHaveBeenCalled();
    expect(discardFormDraft).not.toHaveBeenCalled();
  });

  it("asks before creating a second person with a name already on file", async () => {
    vi.mocked(findSimilarDivers).mockResolvedValue([{ id: DIVER_ID }] as never);
    const to = await landing({
      fullName: "Nadia Ruiz",
      email: "nadia@example.com",
      phone: "",
      surface: "walk-in",
      tripId: TRIP_ID,
    });
    const url = new URL(to ?? "", "https://diveday.test");
    expect(url.pathname).toBe("/shop/blue-mantis/divers/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      confirmName: "Nadia Ruiz",
      confirmEmail: "nadia@example.com",
      surface: "walk-in",
      tripId: TRIP_ID,
    });
    expect(findSimilarDivers).toHaveBeenCalledWith({ db: "handle" }, SHOP_ID, "Nadia Ruiz");
    expect(createDiver).not.toHaveBeenCalled();
  });

  it("creates anyway once the staffer has said it is someone new", async () => {
    vi.mocked(findSimilarDivers).mockResolvedValue([{ id: "other" }] as never);
    await landing({ fullName: "Nadia Ruiz", email: "", phone: "", force: "true" });
    expect(findSimilarDivers).not.toHaveBeenCalled();
    expect(createDiver).toHaveBeenCalled();
  });

  it("hands a full trip's form to the wait list", async () => {
    const fields = {
      fullName: "Nadia Ruiz",
      email: "",
      phone: "",
      surface: "trip-guests",
      tripId: TRIP_ID,
      waitlist: "true",
    };
    expect(await landing(fields)).toBeNull();
    expect(addToWaitlistAction).toHaveBeenCalledWith("blue-mantis", TRIP_ID, expect.any(FormData));
    expect(createDiver).not.toHaveBeenCalled();
  });

  it("hands a seat door's form to the one seating path", async () => {
    for (const surface of ["trip-guests", "walk-in", "new-booking"]) {
      vi.mocked(seatNewDiverAction).mockClear();
      expect(
        await landing({ fullName: "Nadia Ruiz", email: "", phone: "", surface, tripId: TRIP_ID }),
      ).toBeNull();
      expect(seatNewDiverAction).toHaveBeenCalledWith(surface, "blue-mantis", expect.any(FormData));
    }
    expect(createDiver).not.toHaveBeenCalled();
  });

  it("treats a door it does not know as no door at all", async () => {
    await landing({
      fullName: "Nadia Ruiz",
      email: "",
      phone: "",
      surface: "constructor",
      tripId: TRIP_ID,
    });
    expect(seatNewDiverAction).not.toHaveBeenCalled();
    expect(createDiver).toHaveBeenCalled();
  });

  it("says so when the diver could not be created", async () => {
    vi.mocked(createDiver).mockResolvedValue(null as never);
    expect(await landing({ fullName: "Nadia Ruiz", email: "", phone: "" })).toBe(
      "/shop/blue-mantis/divers/new?notice=duplicate",
    );
  });
});
