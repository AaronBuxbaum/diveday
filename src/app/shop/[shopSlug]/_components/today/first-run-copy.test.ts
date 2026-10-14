import { describe, expect, it } from "vitest";
import type { Shop } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { firstRunChecklistCopy } from "./first-run-copy";

const shop = (units: Partial<Shop>) =>
  ({
    currency: "usd",
    depthUnit: "feet",
    temperatureUnit: "fahrenheit",
    timezone: "America/New_York",
    addressCountry: null,
    addressRegion: null,
    ...units,
  }) as Shop;

/**
 * **The units sentence names every unit the shop was started on** (#2417):
 * currency, depth and water temperature, all three picked for where the shop
 * is, by country when it gave one and by timezone otherwise.
 */
describe("the first-run units step", () => {
  const counts = { diveSiteCount: 0, doneCount: 0 };

  it("names the currency, the depth unit and the temperature unit", () => {
    const copy = firstRunChecklistCopy(staffTranslator("en-US"), shop({}), counts);
    expect(copy.unitsBody).toBe(
      "We picked USD, feet and Fahrenheit for where you are. Prices and depths are hard to change later.",
    );
  });

  it("follows a metric shop's units, in Spanish too", () => {
    const metric = shop({ currency: "eur", depthUnit: "meters", temperatureUnit: "celsius" });
    expect(firstRunChecklistCopy(staffTranslator("en-US"), metric, counts).unitsBody).toContain(
      "EUR, meters and Celsius",
    );
    expect(firstRunChecklistCopy(staffTranslator("es-ES"), metric, counts).unitsBody).toContain(
      "EUR, metros y grados Celsius",
    );
  });
});
