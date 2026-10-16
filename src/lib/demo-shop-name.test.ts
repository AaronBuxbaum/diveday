import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { cleanVisitorShopName, VISITOR_SHOP_NAME_MAX } from "./demo-identity";
import { DEMO_SHOP_NAME_MAX_AGE_SECONDS, demoShopNameFor, signDemoShopName } from "./demo-shop-name";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2031, 4, 10, 12);

describe("cleanVisitorShopName", () => {
  it("keeps an ordinary name, closing up its spaces", () => {
    expect(cleanVisitorShopName("  Keys   Reef Divers ")).toBe("Keys Reef Divers");
    expect(cleanVisitorShopName("Buceo Ñandú")).toBe("Buceo Ñandú");
  });

  it("is null for nothing usable", () => {
    expect(cleanVisitorShopName(undefined)).toBeNull();
    expect(cleanVisitorShopName(42)).toBeNull();
    expect(cleanVisitorShopName("   ")).toBeNull();
    expect(cleanVisitorShopName("‮​")).toBeNull();
  });

  it("drops line breaks, bidi overrides and zero-width characters", () => {
    expect(cleanVisitorShopName("Reef\nDivers")).toBe("Reef Divers");
    expect(cleanVisitorShopName("Reef ‮Divers​")).toBe("Reef Divers");
  });

  it("cuts a long name rather than refusing it", () => {
    const name = cleanVisitorShopName("A".repeat(200));
    expect(name).toHaveLength(VISITOR_SHOP_NAME_MAX);
  });
});

describe("the demo shop name cookie", () => {
  it("reads back the cleaned name for the shop it was signed for", () => {
    const value = signDemoShopName(SHOP, " Keys  Reef Divers ", NOW);
    expect(demoShopNameFor(value ?? undefined, SHOP, NOW)).toBe("Keys Reef Divers");
  });

  it("is not set when nothing usable was typed", () => {
    expect(signDemoShopName(SHOP, "", NOW)).toBeNull();
    expect(signDemoShopName(SHOP, null, NOW)).toBeNull();
  });

  it("names nothing in another shop", () => {
    const value = signDemoShopName(OTHER, "Keys Reef Divers", NOW) ?? undefined;
    expect(demoShopNameFor(value, SHOP, NOW)).toBeNull();
  });

  it("lasts as long as a minted demo, then reads as nothing", () => {
    expect(DEMO_SHOP_NAME_MAX_AGE_SECONDS).toBe((7 * DAY_MS) / 1000);
    const value = signDemoShopName(SHOP, "Keys Reef Divers", NOW) ?? undefined;
    expect(demoShopNameFor(value, SHOP, NOW + 7 * DAY_MS - 1)).toBe("Keys Reef Divers");
    expect(demoShopNameFor(value, SHOP, NOW + 7 * DAY_MS)).toBeNull();
  });

  it("refuses a value whose name or expiry was changed after signing", () => {
    const [expires, , sig] = (signDemoShopName(SHOP, "Keys Reef Divers", NOW) ?? "").split(".");
    const forged = Buffer.from("Blue Mantis Divers", "utf8").toString("base64url");
    expect(demoShopNameFor(`${expires}.${forged}.${sig}`, SHOP, NOW)).toBeNull();
    const [, encoded] = (signDemoShopName(SHOP, "Keys Reef Divers", NOW) ?? "").split(".");
    expect(demoShopNameFor(`${Number(expires) + DAY_MS}.${encoded}.${sig}`, SHOP, NOW)).toBeNull();
  });

  it("refuses garbage", () => {
    expect(demoShopNameFor(undefined, SHOP, NOW)).toBeNull();
    expect(demoShopNameFor("not-a-cookie", SHOP, NOW)).toBeNull();
  });
});
