import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diveSites, executedDives, trips } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { detailsReadRows, repeatsRowText } from "./details-rows";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();
const t = staffTranslator("en-US");

/** Fifth-loop ideas, item 6: Details says what each planned site was like last time. */
describe("detailsReadRows (in-memory PGlite)", () => {
  it("says the last dive on a planned site in one Last time row, and reads nothing off Details", async () => {
    const { db, shop } = ctx;
    const [earlier, later] = await db
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), isNull(trips.deletedAt)))
      .orderBy(asc(trips.startsAt), asc(trips.id))
      .limit(2);
    const [site] = await db
      .select({ id: diveSites.id, name: diveSites.name })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .orderBy(asc(diveSites.name))
      .limit(1);
    if (!earlier || !later || !site) throw new Error("demo trips or sites missing");
    await db.delete(executedDives).where(eq(executedDives.tripId, earlier.id));
    await db.insert(executedDives).values({
      shopId: shop.id,
      tripId: earlier.id,
      diveNumber: 1,
      actualSiteId: site.id,
      observedConditions: { visibility: "40 ft" },
    });
    const overview = { trip: later, diveSites: { sites: [site] } };
    const rows = await detailsReadRows({ db, shop, overview, t, locale: "en-US", shown: true });
    const history = rows.find((row) => row.id === "site-history");
    expect(history?.label).toBe("Last time");
    expect(history?.value).toContain(`${site.name}: last dived`);
    expect(history?.value).toContain("visibility 40 ft");
    expect(await detailsReadRows({ db, shop, overview, t, locale: "en-US", shown: false })).toEqual(
      [],
    );
  });
});

const SATURDAYS = 1 << 6;
const run = {
  intervalWeeks: 1,
  weekdayMask: SATURDAYS as never,
  endsOn: null,
  futureScheduledCount: 4,
  yardDatesLeftOff: [],
};

describe("repeatsRowText: a run's standing crew", () => {
  it("names two crew in the locale's list and says they crew every date", () => {
    const text = repeatsRowText(staffTranslator("en-US"), "en-US", {
      ...run,
      standingCrewNames: ["Dana", "Luis"],
    });
    expect(text).toContain("Dana and Luis crew every date.");
  });

  it("agrees with a single crew member, in Spanish too", () => {
    expect(
      repeatsRowText(staffTranslator("en-US"), "en-US", { ...run, standingCrewNames: ["Dana"] }),
    ).toContain("Dana crews every date.");
    expect(
      repeatsRowText(staffTranslator("es-ES"), "es-ES", {
        ...run,
        standingCrewNames: ["Dana", "Luis"],
      }),
    ).toContain("Dana y Luis tripulan todas las fechas.");
  });

  it("says nothing about crew when the run has none", () => {
    const text = repeatsRowText(staffTranslator("en-US"), "en-US", {
      ...run,
      standingCrewNames: [],
    });
    expect(text).not.toMatch(/crew/i);
  });
});

describe("repeatsRowText: the yard weeks the roll left off", () => {
  const withYard = (yardDatesLeftOff: string[]) => ({
    ...run,
    standingCrewNames: [],
    yardDatesLeftOff: yardDatesLeftOff as never,
  });

  it("says nothing when the roll left no week off", () => {
    expect(repeatsRowText(staffTranslator("en-US"), "en-US", withYard([]))).not.toContain(
      "out of service",
    );
  });

  it("names the dates the boat's window kept off the board", () => {
    const text = repeatsRowText(
      staffTranslator("en-US"),
      "en-US",
      withYard(["2031-01-08", "2031-01-15"]),
    );
    expect(text).toMatch(
      /Left off the board, the boat is out of service then: Jan\s8,\s2031 and Jan\s15,\s2031\./,
    );
  });

  it("names the first three and counts the rest", () => {
    const text = repeatsRowText(
      staffTranslator("en-US"),
      "en-US",
      withYard(["2031-01-08", "2031-01-15", "2031-01-22", "2031-01-29", "2031-02-05"]),
    );
    expect(text).toMatch(/Jan\s22,\s2031, and 2 more\./);
  });

  it("says it in Spanish", () => {
    const text = repeatsRowText(staffTranslator("es-ES"), "es-ES", withYard(["2031-01-08"]));
    expect(text).toContain("Fuera del calendario porque el barco estará fuera de servicio:");
  });
});
