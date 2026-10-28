import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { listBoats } from "@/db/boats";
import { diveSites, trips } from "@/db/schema";
import { listTripLenses } from "@/db/trip-lenses";
import { getTripOverview, listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { tripAboutRows } from "./trip-about-rows";
import { tripCrewNotes } from "./trip-crew-notes";

const ctx = fileScopedShopContext();
const t = staffTranslator("en-US");

async function rowsFor(
  tripNotice?: Parameters<typeof tripAboutRows>[0]["tripNotice"],
  canConfigure?: boolean,
  held?: Parameters<typeof tripAboutRows>[0]["held"],
) {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  const overview = await getTripOverview(db, shop, reef.id, staff.person.id);
  if (!overview) throw new Error("overview missing");
  return tripAboutRows({
    overview: { ...overview, canConfigure: canConfigure ?? overview.canConfigure },
    crewNotes: tripCrewNotes({ crew: overview.crew, diversPerDivemaster: 8, locale: "en-US", t }),
    liveBoatClashes: [],
    shop: shop as never,
    shopSlug: shop.slug,
    tripId: reef.id,
    locale: "en-US",
    t,
    tripNotice,
    held,
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
    expect(ids.slice(0, 7)).toEqual([
      "plan",
      "meeting",
      "timing",
      "details",
      "departure-details",
      "conditions",
      "requirements",
    ]);
    expect(ids.slice(-2)).toEqual(["about-crew", "series"]);
  });

  it.each(["timing", "meeting"])(
    "keeps a %s hold on its editor after the flash notice is cleared",
    async (section) => {
      const held = { id: "b0707cc2-aa54-4c28-b352-d29444f9478a", section };
      const rows = await rowsFor(undefined, true, held);
      expect(rows.find((row) => row.id === section)?.editor).toMatchObject({
        props: { held: held.id, section },
      });
      const other = section === "timing" ? "meeting" : "timing";
      expect(rows.find((row) => row.id === other)?.editor).toMatchObject({
        props: { held: undefined, section: other },
      });
    },
  );

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
    const plan = rows.find((row) => row.id === "plan");
    expect(String(plan?.value)).toContain("Molasses");
    const who = rows.find((row) => row.id === "requirements");
    expect(typeof who?.value).toBe("string");
    expect(who?.value).not.toBe("");
    expect(String(who?.value)).toContain("Open Water");
  });

  it("says where the boat meets, the shop's own door when the departure names none", async () => {
    // UX review 2026-10-13, item 18: the meeting point lived only inside the
    // plan's editor, so the crew knew less than the diver about the dock.
    const rows = await rowsFor();
    const meeting = rows.find((row) => row.id === "meeting");
    expect(meeting?.label).toBe("Where we meet");
    expect(String(meeting?.value)).toContain(ctx.shop.name);
    expect(meeting?.editor).toMatchObject({ props: { section: "meeting" } });
  });

  it("scopes each configuration editor to its saved subject and respects configuration permission", async () => {
    const subjects = [
      ["plan", "plan"],
      ["meeting", "meeting"],
      ["timing", "timing"],
      ["details", "booking"],
      ["departure-details", "departure"],
    ];
    const configured = await rowsFor();
    for (const [id, section] of subjects) {
      expect(configured.find((row) => row.id === id)?.editor).toMatchObject({
        props: { section },
      });
    }

    const readOnly = await rowsFor(undefined, false);
    for (const [id] of subjects) {
      expect(readOnly.find((row) => row.id === id)?.editor).toBeUndefined();
      expect(readOnly.find((row) => row.id === id)?.value).toEqual(
        configured.find((row) => row.id === id)?.value,
      );
    }
    expect(readOnly.find((row) => row.id === "requirements")?.editor).toBeUndefined();
    expect(readOnly.find((row) => row.id === "requirements")?.value).toEqual(
      configured.find((row) => row.id === "requirements")?.value,
    );
    expect(readOnly.find((row) => row.id === "conditions")?.editor).toBeDefined();
  });

  it("opens the row its own form reported back to", async () => {
    const closed = await rowsFor();
    expect(closed.find((row) => row.id === "conditions")?.editorOpen).toBe(false);
    const open = await rowsFor({ form: "conditions", tone: "danger", text: "No." });
    expect(open.find((row) => row.id === "conditions")?.editorOpen).toBe(true);
  });

  /**
   * Domain review F8: closing the snorkeler seats does not take the booked
   * snorkeler (`seed-mixed-boat.ts`) off the reef boat, so the line still says
   * every planned site is marked not good for snorkeling.
   */
  it("warns about a booked snorkeler over unsuitable sites, seats closed", async () => {
    const { db, shop } = ctx;
    const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("demo reef trip missing");
    await db.update(diveSites).set({ snorkelSuitable: false }).where(eq(diveSites.shopId, shop.id));
    await db.update(trips).set({ snorkelerPriceCents: null }).where(eq(trips.id, reef.id));
    const terms = (await rowsFor()).find((row) => row.id === "participant-terms");
    expect(renderToStaticMarkup(terms?.value)).toContain(
      "A snorkeler is booked, but every planned site is marked not good for snorkeling.",
    );
  });
});
