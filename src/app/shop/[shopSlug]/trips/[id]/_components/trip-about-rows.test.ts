import { describe, expect, it } from "vitest";
import { listBoats } from "@/db/boats";
import { listTripLenses } from "@/db/trip-lenses";
import { getTripOverview, listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { tripAboutRows } from "./trip-about-rows";
import { tripCrewNotes } from "./trip-crew-notes";

const ctx = fileScopedShopContext();
const t = staffTranslator("en-US");

async function rowsFor(tripNotice?: Parameters<typeof tripAboutRows>[0]["tripNotice"]) {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  const overview = await getTripOverview(db, shop, reef.id, staff.person.id);
  if (!overview) throw new Error("overview missing");
  return tripAboutRows({
    overview,
    crewNotes: tripCrewNotes({ crew: overview.crew, diversPerDivemaster: 8, locale: "en-US", t }),
    liveBoatClashes: [],
    shop: shop as never,
    shopSlug: shop.slug,
    tripId: reef.id,
    locale: "en-US",
    t,
    tripNotice,
    shopBoats: await listBoats(db, shop.id),
    shopLenses: await listTripLenses(db, shop.id),
    automatedForecast: Promise.resolve(null),
    tideLines: Promise.resolve([]),
  });
}

describe("tripAboutRows (in-memory PGlite)", () => {
  it("lays the departure flat in its rows' order", async () => {
    const rows = await rowsFor();
    const ids = rows.map((row) => row.id);
    expect(ids.slice(0, 4)).toEqual(["details", "meeting", "conditions", "requirements"]);
    expect(ids.slice(-2)).toEqual(["about-crew", "series"]);
  });

  it("reads the crew's conditions with the water temperature and a round visibility", async () => {
    // Fourth review, item 54: the seeded 27 °C never showed on the line, the
    // afternoon boat read "A calm morning", and 18 m read as an odd 59 ft.
    const rows = await rowsFor();
    const conditions = String(rows.find((row) => row.id === "conditions")?.value);
    expect(conditions).toContain("Water 81 °F");
    expect(conditions).toContain("60 ft visibility");
    expect(conditions).not.toContain("morning");
  });

  it("summarises the plan by its sites and says who can book", async () => {
    const rows = await rowsFor();
    const plan = rows.find((row) => row.id === "details");
    expect(String(plan?.value)).toContain("Molasses");
    const who = rows.find((row) => row.id === "requirements");
    expect(typeof who?.value).toBe("string");
    expect(who?.value).not.toBe("");
  });

  it("says where the boat meets, the shop's own door when the departure names none", async () => {
    // UX review 2026-10-13, item 18: the meeting point lived only inside the
    // plan's editor, so the crew knew less than the diver about the dock.
    const rows = await rowsFor();
    const meeting = rows.find((row) => row.id === "meeting");
    expect(meeting?.label).toBe("Where we meet");
    expect(String(meeting?.value)).toContain(ctx.shop.name);
    expect(meeting?.editor).toBeUndefined();
  });

  it("opens the row its own form reported back to", async () => {
    const closed = await rowsFor();
    expect(closed.find((row) => row.id === "conditions")?.editorOpen).toBe(false);
    const open = await rowsFor({ form: "conditions", tone: "danger", text: "No." });
    expect(open.find((row) => row.id === "conditions")?.editorOpen).toBe(true);
  });
});
