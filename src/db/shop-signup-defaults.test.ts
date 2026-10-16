// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { unseededTestDb } from "@/test/db";
import { recordSetupRequest } from "./funnel";
import { issueSetupLink } from "./setup-links";
import { createSignedUpShop } from "./shop-signup";

/**
 * **A new shop's starting units follow its timezone's country** (issue #2571,
 * option B). Sign-up asks for no country, so a shop in Zurich or Tokyo used to
 * start in US dollars and a Phoenix shop in metres. The lookup itself is pinned
 * in `curated-currency.test.ts`; this pins that sign-up reads it.
 */
async function signUpIn(timezone: string) {
  const db = await unseededTestDb();
  const request = await recordSetupRequest(db, {
    shopName: "Reef Line Divers",
    region: "Anywhere",
    runsBoat: true,
    currentSystem: "paper",
    contactName: "Ana Ruiz",
    email: "ana@reefline.example",
    phone: null,
    source: "pricing",
    locale: "en-US",
  });
  const link = await issueSetupLink(db, { setupRequestId: request.id, now: nowDate() });
  const outcome = await createSignedUpShop(db, {
    setupToken: link.token,
    shopName: "Reef Line Divers",
    shopSlug: "reef-line",
    timezone,
    ownerName: "Ana Ruiz",
    ownerEmail: "ana@reefline.example",
    ownerPassword: "a long enough passphrase 123",
  });
  if (!outcome.ok) throw new Error(`sign-up refused: ${outcome.reason}`);
  return outcome.shop;
}

describe("a shop that signs up with only a timezone", () => {
  it.each([
    ["Europe/Zurich", "chf", "meters", "celsius"],
    ["Asia/Tokyo", "jpy", "meters", "celsius"],
    ["Europe/Warsaw", "usd", "meters", "celsius"],
    ["America/Phoenix", "usd", "feet", "fahrenheit"],
    ["Europe/Madrid", "eur", "meters", "celsius"],
  ])(
    "starts a shop in %s on %s, %s and %s",
    async (timezone, currency, depthUnit, temperatureUnit) => {
      const shop = await signUpIn(timezone);
      expect({
        currency: shop.currency,
        depthUnit: shop.depthUnit,
        temperatureUnit: shop.temperatureUnit,
      }).toEqual({ currency, depthUnit, temperatureUnit });
    },
  );
});
