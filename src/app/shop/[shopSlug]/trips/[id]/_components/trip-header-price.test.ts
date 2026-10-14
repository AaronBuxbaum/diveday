import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { tripHeaderPrice } from "./trip-header-price";

const t = staffTranslator("en-US");

describe("tripHeaderPrice", () => {
  it("prints a whole price the way the board and the public page do", () => {
    expect(tripHeaderPrice(9500, "usd", "en-US", t)).toBe("$95 per diver");
  });

  it("keeps the cents a price really has", () => {
    expect(tripHeaderPrice(6250, "usd", "en-US", t)).toBe("$62.50 per diver");
  });

  it("says nothing for a departure with no price", () => {
    expect(tripHeaderPrice(null, "usd", "en-US", t)).toBeUndefined();
  });
});
