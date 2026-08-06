import { describe, expect, it } from "vitest";
import {
  cachedCollator,
  cachedDisplayNames,
  cachedFormatter,
  cachedListFormat,
  cachedPluralRules,
} from "./intl-cache";

describe("cachedFormatter", () => {
  it("hands back the same instance for the same locale and options", () => {
    const first = cachedFormatter("dt", Intl.DateTimeFormat, "en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
    });
    const second = cachedFormatter("dt", Intl.DateTimeFormat, "en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
    });
    expect(second).toBe(first);
  });

  it("keeps formatters for different timezones apart", () => {
    // The whole reason a shared cache is safe is that the key carries every
    // input that changes the output. A zone collision here would render a Key
    // Largo departure in Vancouver time — the exact class of bug the required
    // `timeZone` parameter in format.ts exists to prevent.
    const key = { hour: "numeric", minute: "2-digit" } as const;
    const eastern = cachedFormatter("dt", Intl.DateTimeFormat, "en-US", {
      ...key,
      timeZone: "America/New_York",
    });
    const pacific = cachedFormatter("dt", Intl.DateTimeFormat, "en-US", {
      ...key,
      timeZone: "America/Vancouver",
    });
    expect(pacific).not.toBe(eastern);
    const departure = new Date("2026-08-06T11:30:00.000Z");
    expect(eastern.format(departure)).not.toBe(pacific.format(departure));
  });

  it("keeps formatters for different locales apart", () => {
    const enUS = cachedFormatter("num", Intl.NumberFormat, "en-US", {
      style: "currency",
      currency: "USD",
    });
    const esES = cachedFormatter("num", Intl.NumberFormat, "es-ES", {
      style: "currency",
      currency: "USD",
    });
    expect(esES).not.toBe(enUS);
    expect(esES.format(1234.5)).not.toBe(enUS.format(1234.5));
  });

  it("keeps different constructors apart even at the same locale and options", () => {
    const number = cachedFormatter("num", Intl.NumberFormat, "en-US", {});
    const list = cachedFormatter("list", Intl.ListFormat, "en-US", {});
    expect(list).not.toBe(number);
  });

  it("still formats correctly on the cached path, not just the first call", () => {
    const options = { style: "currency", currency: "USD" } as const;
    const first = cachedFormatter("num", Intl.NumberFormat, "en-US", options).format(130);
    const second = cachedFormatter("num", Intl.NumberFormat, "en-US", options).format(130);
    expect(second).toBe(first);
    expect(second).toBe("$130.00");
  });
});

describe("cachedListFormat", () => {
  it("reuses one instance across calls", () => {
    const first = cachedListFormat("en-US", { type: "conjunction" });
    const second = cachedListFormat("en-US", { type: "conjunction" });
    expect(second).toBe(first);
  });

  it("keeps conjunction and disjunction apart", () => {
    const and = cachedListFormat("en-US", { type: "conjunction" });
    const or = cachedListFormat("en-US", { type: "disjunction" });
    expect(or).not.toBe(and);
    const sites = ["Blue Heron", "Molasses Reef"];
    expect(and.format(sites)).not.toBe(or.format(sites));
  });
});

describe("cachedPluralRules", () => {
  it("reuses one instance and still selects the right category", () => {
    const first = cachedPluralRules("en-US");
    expect(cachedPluralRules("en-US")).toBe(first);
    expect(first.select(1)).toBe("one");
    expect(first.select(2)).toBe("other");
  });

  it("keeps locales apart — plural rules are not universal", () => {
    // The reason the locale must be in the key: Polish has a "few" category
    // that English does not, so a shared instance would silently answer for
    // the wrong language.
    const english = cachedPluralRules("en-US");
    const polish = cachedPluralRules("pl-PL");
    expect(polish).not.toBe(english);
    expect(polish.select(3)).toBe("few");
    expect(english.select(3)).toBe("other");
  });
});

describe("cachedCollator", () => {
  it("reuses one instance per locale and options", () => {
    const first = cachedCollator("es-ES");
    expect(cachedCollator("es-ES")).toBe(first);
    expect(cachedCollator("es-ES", { sensitivity: "base" })).not.toBe(first);
  });

  it("still orders correctly on the cached path", () => {
    const collator = cachedCollator("en-US");
    expect(["Cozumel", "Bonaire", "Aruba"].sort(collator.compare)).toEqual([
      "Aruba",
      "Bonaire",
      "Cozumel",
    ]);
  });
});

describe("cachedDisplayNames", () => {
  it("reuses one instance per locale and options", () => {
    const first = cachedDisplayNames("en-US", { type: "currency" });
    expect(cachedDisplayNames("en-US", { type: "currency" })).toBe(first);
    expect(cachedDisplayNames("en-US", { type: "region" })).not.toBe(first);
  });

  it("resolves a currency name, and a different locale gives a different one", () => {
    expect(cachedDisplayNames("en-US", { type: "currency" }).of("USD")).toBe("US Dollar");
    expect(cachedDisplayNames("es-ES", { type: "currency" }).of("USD")).not.toBe("US Dollar");
  });
});
