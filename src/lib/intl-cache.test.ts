import { describe, expect, it } from "vitest";
import { cachedFormatter, cachedListFormat } from "./intl-cache";

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
