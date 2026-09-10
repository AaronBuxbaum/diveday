import { describe, expect, it } from "vitest";
import {
  AA_TEXT_CONTRAST,
  BRAND_DEFAULT_SURFACE,
  contrastRatio,
  DIVEDAY_BRAND_COLOR,
  deriveBrandTheme,
} from "./brand";
import {
  DAY_LINE_SPAN,
  dayLineHours,
  dayLinePosition,
  dayLineWindow,
  departureMinutes,
  firstDepartureDay,
  firstDepartureEndTime,
  MAX_TRY_IT_NAME,
  MINUTES_IN_DAY,
  minutesUntilDeparture,
  parseDepartureTime,
  parseTryItHandoff,
  parseTryItName,
  suggestedBrandColor,
  tryItOnboardHref,
  tryItThemeDeclarations,
} from "./try-it";

/**
 * A spread of the names a dive shop actually signs, plus the shapes that break
 * hashes: one word, punctuation, an ampersand, an accent, a non-Latin script,
 * and the two lengths at the edges. Every one of them has to come back with a
 * colour a link can be painted in.
 */
const SHOP_NAMES = [
  "Coral Cove Dive Co.",
  "Blue Mantis Divers",
  "Reef & Wreck",
  "Buceo Cozumel",
  "Sótano Azul",
  "潜水店",
  "A",
  "Key Largo Scuba Adventures and Charters",
];

describe("parseTryItName", () => {
  it("collapses the whitespace a paste carries and trims the ends", () => {
    expect(parseTryItName("  Coral   Cove  Dive Co. ")).toBe("Coral Cove Dive Co.");
  });

  it("refuses a name with nothing in it", () => {
    expect(parseTryItName("   ")).toBeNull();
    expect(parseTryItName("")).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(parseTryItName(undefined)).toBeNull();
    expect(parseTryItName(["Coral Cove"])).toBeNull();
    expect(parseTryItName(7)).toBeNull();
  });

  it("refuses a name past the carried length rather than truncating one", () => {
    expect(parseTryItName("a".repeat(MAX_TRY_IT_NAME))).toHaveLength(MAX_TRY_IT_NAME);
    expect(parseTryItName("a".repeat(MAX_TRY_IT_NAME + 1))).toBeNull();
  });

  it("refuses control and invisible characters", () => {
    // A newline is a two-line name; a zero-width joiner paints identically to
    // the name beside it and is how two shops look like one.
    expect(parseTryItName("Coral\nCove")).toBeNull();
    expect(parseTryItName("Coral\u200dCove")).toBeNull();
    expect(parseTryItName("Coral\u0000Cove")).toBeNull();
  });
});

describe("parseDepartureTime", () => {
  it("takes what a time field submits", () => {
    expect(parseDepartureTime("07:30")).toBe("07:30");
    expect(parseDepartureTime("00:00")).toBe("00:00");
    expect(parseDepartureTime("23:59")).toBe("23:59");
  });

  it("refuses junk, a bare hour, and an hour that does not exist", () => {
    for (const input of ["7:30", "7", "07:30 AM", "24:00", "23:60", "0730", "", "abc", null, 730]) {
      expect(parseDepartureTime(input)).toBeNull();
    }
  });
});

describe("minutesUntilDeparture", () => {
  it("counts to a departure still ahead today", () => {
    // The canvas's own frame: 6:31 on the clock, a 7:30 boat, 59 minutes.
    expect(minutesUntilDeparture(departureMinutes("07:30") ?? 0, 6 * 60 + 31)).toBe(59);
  });

  it("counts to the same time tomorrow once it has passed", () => {
    expect(minutesUntilDeparture(departureMinutes("07:30") ?? 0, 9 * 60)).toBe(22 * 60 + 30);
  });

  it("is zero at the minute the boat leaves, never negative", () => {
    expect(minutesUntilDeparture(450, 450)).toBe(0);
    for (let now = 0; now < 24 * 60; now += 7) {
      expect(minutesUntilDeparture(450, now)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("firstDepartureDay", () => {
  it("is tomorrow in the shop's zone, not the server's", () => {
    // 03:30 UTC on the 2nd is still the 1st in Key Largo, so the first
    // departure belongs on the 2nd there and the 3rd in Bangkok.
    const now = new Date("2026-09-02T03:30:00Z");
    expect(firstDepartureDay(now, "America/New_York")).toBe("2026-09-02");
    expect(firstDepartureDay(now, "Asia/Bangkok")).toBe("2026-09-03");
  });
});

describe("firstDepartureEndTime", () => {
  it("runs four hours from the typed time", () => {
    expect(firstDepartureEndTime("07:30")).toBe("11:30");
    expect(firstDepartureEndTime("08:00")).toBe("12:00");
  });

  it("holds a late departure inside its own day", () => {
    // `tripDetailsPatch` reads a start and an end against one date, so an end
    // past midnight is a departure that never gets created at all.
    expect(firstDepartureEndTime("22:00")).toBe("23:59");
    expect(firstDepartureEndTime("23:58")).toBe("23:59");
  });

  it("has no answer at the very end of the day, where there is nothing to clamp into", () => {
    // 23:59 clamps to its own start, which `tripDetailsPatch` refuses as
    // `end_before_start` — so this says no first, and `createFirstDay` writes
    // neither the departure nor the hull it would have sailed on.
    expect(firstDepartureEndTime("23:59")).toBeNull();
  });

  it("has no answer for a time it cannot read", () => {
    expect(firstDepartureEndTime("7:30")).toBeNull();
  });
});

describe("the day line", () => {
  it("draws the working day for a boat that leaves inside it", () => {
    const window = dayLineWindow(departureMinutes("07:30") ?? 0);
    expect(window).toEqual({ start: 5 * 60, span: DAY_LINE_SPAN });
    expect(dayLineHours(window)).toEqual([6, 9, 12, 15, 18, 21]);
  });

  it("slides so an early or a late boat is still on the line, with air either side", () => {
    for (const time of ["00:30", "04:00", "07:30", "17:45", "22:00", "23:30"]) {
      const departure = departureMinutes(time) ?? 0;
      const position = dayLinePosition(departure, dayLineWindow(departure));
      expect(position).not.toBeNull();
      expect(position).toBeGreaterThan(0);
      expect(position).toBeLessThan(1);
    }
  });

  it("keeps the window inside the day it is drawing", () => {
    for (let departure = 0; departure < MINUTES_IN_DAY; departure += 15) {
      const window = dayLineWindow(departure);
      expect(window.start).toBeGreaterThanOrEqual(0);
      expect(window.start + window.span).toBeLessThanOrEqual(MINUTES_IN_DAY);
    }
  });

  it("has nowhere to put a marker that falls outside it", () => {
    // 3 AM against a 7:30 boat: the day on the line has not started, and an
    // edge-clamped marker would say it had.
    const window = dayLineWindow(departureMinutes("07:30") ?? 0);
    expect(dayLinePosition(3 * 60, window)).toBeNull();
    expect(dayLinePosition(23 * 60, window)).toBeNull();
    expect(dayLinePosition(6 * 60, window)).toBeCloseTo(1 / 16);
  });
});

describe("suggestedBrandColor", () => {
  it("gives the same shop the same colour every time", () => {
    for (const name of SHOP_NAMES) {
      expect(suggestedBrandColor(name)).toBe(suggestedBrandColor(name));
    }
  });

  it("reads the name the way a person does — case and spacing are not identity", () => {
    expect(suggestedBrandColor("coral  cove dive co.")).toBe(
      suggestedBrandColor(" Coral Cove Dive Co. "),
    );
  });

  it("gives different shops different colours", () => {
    const colors = new Set(SHOP_NAMES.map(suggestedBrandColor));
    expect(colors.size).toBe(SHOP_NAMES.length);
  });

  /**
   * The whole reason the hue goes through `deriveBrandTheme`: a suggested
   * colour is a *link* on the storefront before it is a button fill, and a
   * storefront whose links fail 4.5:1 on the day it opens is what Harbor's
   * derivation exists to prevent (ADR 20260901-diveday-reimagined, decision 2).
   */
  it("clears the text contrast floor on the ground and on its own tint", () => {
    for (const name of SHOP_NAMES) {
      const color = suggestedBrandColor(name);
      expect(contrastRatio(color, BRAND_DEFAULT_SURFACE)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
      // The tint is 8% of the fill over the ground, the same mix `deriveBrandTheme`
      // checks — a link on a selected row has to read there too.
      expect(contrastRatio(color, deriveBrandTheme(color).primaryTint)).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      );
    }
  });

  it("is already what Harbor would derive, so nothing moves it a second time", () => {
    for (const name of SHOP_NAMES) {
      const color = suggestedBrandColor(name);
      expect(deriveBrandTheme(color).primary).toBe(color);
    }
  });

  it("falls back to DiveDay's own colour for a name it cannot read", () => {
    expect(suggestedBrandColor("   ")).toBe(DIVEDAY_BRAND_COLOR);
    expect(suggestedBrandColor("a".repeat(MAX_TRY_IT_NAME + 1))).toBe(DIVEDAY_BRAND_COLOR);
  });
});

describe("tryItThemeDeclarations", () => {
  /** Every value in a `name:value` list, whatever the property is called. */
  const values = (block: string) =>
    block
      .split(";")
      .filter(Boolean)
      .map((declaration) => declaration.slice(declaration.indexOf(":") + 1));

  it("emits nothing but hex colours, whatever it is handed", () => {
    // This is the one function in the slice whose output is rendered as
    // *stylesheet text*, so what it will not take matters more than what it
    // will: a string that closes the block and opens its own is not a colour.
    for (const input of [
      "red;}body{display:none",
      "#8a3b1f;}[data-try-it-drawn]{--primary:red",
      "url(https://example.invalid/x)",
      "",
      "javascript:alert(1)",
    ]) {
      const theme = tryItThemeDeclarations(input);
      for (const block of [theme.light, theme.dark]) {
        expect(block).not.toContain("}");
        expect(block).not.toContain("{");
        for (const value of values(block)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("falls back to DiveDay's own colour for anything that is not one", () => {
    expect(tryItThemeDeclarations("red;}body{display:none")).toEqual(
      tryItThemeDeclarations(DIVEDAY_BRAND_COLOR),
    );
  });

  it("dresses a real colour in itself, in both schemes", () => {
    const color = suggestedBrandColor("Coral Cove Dive Co.");
    const theme = tryItThemeDeclarations(color);
    expect(theme.light).toContain(`--color-primary:${color}`);
    // The dark scheme derives the same hue against the deep ground, so the two
    // blocks must not be the same block (issue #1265's whole shape).
    expect(theme.dark).not.toBe(theme.light);
  });
});

describe("parseTryItHandoff", () => {
  it("reads back what the hero wrote", () => {
    expect(
      parseTryItHandoff({
        shop: "Coral Cove Dive Co.",
        boat: "Reef Runner",
        departure: "07:30",
        color: "#8a3b1f",
      }),
    ).toEqual({
      shopName: "Coral Cove Dive Co.",
      boatName: "Reef Runner",
      departure: "07:30",
      brandColor: "#8a3b1f",
    });
  });

  it("drops only the field that is junk", () => {
    expect(
      parseTryItHandoff({
        shop: "Coral Cove Dive Co.",
        boat: "a".repeat(MAX_TRY_IT_NAME + 1),
        departure: "half past seven",
        color: "not-a-colour",
      }),
    ).toEqual({
      shopName: "Coral Cove Dive Co.",
      boatName: null,
      departure: null,
      brandColor: null,
    });
  });

  it("takes neither value when a parameter is repeated", () => {
    expect(parseTryItHandoff({ shop: ["Coral Cove", "Blue Mantis"] }).shopName).toBeNull();
  });

  it("has nothing to say about a bare door", () => {
    expect(parseTryItHandoff({})).toEqual({
      shopName: null,
      boatName: null,
      departure: null,
      brandColor: null,
    });
  });
});

describe("tryItOnboardHref", () => {
  it("carries the three fields and the colour, behind the funnel tag", () => {
    const href = tryItOnboardHref({
      shopName: "Coral Cove Dive Co.",
      boatName: "Reef Runner",
      departure: "07:30",
      brandColor: "#8a3b1f",
    });
    expect(href).toBe(
      "/onboard?from=home-drawn&shop=Coral+Cove+Dive+Co.&boat=Reef+Runner&departure=07%3A30&color=%238a3b1f",
    );
  });

  it("round-trips through the door's own reader", () => {
    const typed = {
      shopName: "Sótano Azul",
      boatName: "Reef & Wreck",
      departure: "06:15",
      brandColor: suggestedBrandColor("Sótano Azul"),
    };
    const params = new URL(tryItOnboardHref(typed), "https://dive.day").searchParams;
    expect(
      parseTryItHandoff({
        shop: params.get("shop") ?? undefined,
        boat: params.get("boat") ?? undefined,
        departure: params.get("departure") ?? undefined,
        color: params.get("color") ?? undefined,
      }),
    ).toEqual(typed);
  });

  it("carries only what was typed", () => {
    expect(tryItOnboardHref({ shopName: "Coral Cove Dive Co." })).toBe(
      "/onboard?from=home-drawn&shop=Coral+Cove+Dive+Co.",
    );
    expect(tryItOnboardHref({})).toBe("/onboard?from=home-drawn");
  });
});
