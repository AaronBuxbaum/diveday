import { describe, expect, it } from "vitest";
import {
  formatByteSize,
  formatDateTimeTz,
  formatDateWithYear,
  formatDayParts,
  formatOrdinal,
  formatRelativeDay,
  formatShortDate,
  formatTime,
  formatTimeRange,
  formatTimeRangeTz,
  isValidTimeZone,
  weekdayNames,
} from "./format";

const morning = new Date("2026-07-17T07:30:00Z");
const midday = new Date("2026-07-17T11:00:00Z");

describe("isValidTimeZone (CR-014)", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Pacific/Honolulu")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects a well-formed but nonexistent zone", () => {
    expect(isValidTimeZone("Etc/Nowhere")).toBe(false);
  });

  it("rejects garbage and an empty string", () => {
    expect(isValidTimeZone("not a timezone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("formatShortDate", () => {
  it("renders weekday, month, and day", () => {
    expect(formatShortDate(morning, "en-US", "UTC")).toBe("Fri, Jul 17");
  });
});

describe("formatDateWithYear", () => {
  it("names the year and drops the weekday", () => {
    expect(formatDateWithYear(morning, "en-US", "UTC")).toBe("Jul 17, 2026");
  });

  it("resolves the day in the named zone rather than the host's", () => {
    // Late on the 16th in Honolulu, already the 17th in UTC — the assertion
    // that fails if the `timeZone` argument is ever dropped on a UTC CI box.
    expect(formatDateWithYear(morning, "en-US", "Pacific/Honolulu")).toBe("Jul 16, 2026");
  });
});

describe("formatDayParts", () => {
  it("hands back the localized weekday, day numeral, and month separately", () => {
    expect(formatDayParts(morning, "en-US", "UTC")).toEqual({
      weekday: "Fri",
      day: "17",
      month: "Jul",
    });
  });

  it("resolves the calendar day in the shop's zone, not the host's", () => {
    // 2026-07-17T02:30Z is still the evening of the 16th in New York.
    const lateNightUtc = new Date("2026-07-17T02:30:00Z");
    expect(formatDayParts(lateNightUtc, "en-US", "America/New_York").day).toBe("16");
  });

  it("localizes every piece", () => {
    const parts = formatDayParts(morning, "es-ES", "UTC");
    expect(parts.day).toBe("17");
    expect(parts.month.toLowerCase()).toContain("jul");
  });
});

describe("formatTime", () => {
  it("renders 12-hour time with minutes", () => {
    expect(formatTime(morning, "en-US", "UTC")).toBe("7:30 AM");
  });
});

describe("formatDateTimeTz", () => {
  it("includes a timezone on safety-relevant timestamps", () => {
    expect(formatDateTimeTz(morning, "en-US", "UTC")).toBe("Jul 17, 7:30 AM UTC");
  });

  /**
   * **No seconds, in any locale.**
   *
   * The public booking page's forecast note built its own timestamp with a bare
   * `toLocaleString`, whose default field set carries seconds — so a diver
   * deciding what to pack read "Updated 8/22/2026, 10:33:06 AM EDT" (issue
   * #799). The value is the same instant either way; the claim it makes is not.
   *
   * Asserted as "no third `:` group" rather than against a fixed string,
   * because the failure is a *field* creeping back in and that is what a locale
   * change would carry with it.
   */
  it.each(["en-US", "es-ES"])("renders to the minute in %s, never the second", (locale) => {
    const withSeconds = new Date("2026-07-17T07:30:06Z");
    const rendered = formatDateTimeTz(withSeconds, locale, "UTC");
    expect(rendered).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(rendered).not.toContain("06");
    // And still says the two things it exists to say.
    expect(rendered).toMatch(/7:30|07:30/);
    expect(rendered).toContain("UTC");
  });
});

describe("formatTimeRange", () => {
  it("joins start and end with an en dash", () => {
    expect(formatTimeRange(morning, midday, "en-US", "UTC")).toBe("7:30 AM – 11:00 AM");
  });
});

describe("formatTimeRangeTz", () => {
  it("labels the end time with the zone", () => {
    expect(formatTimeRangeTz(morning, midday, "en-US", "UTC")).toBe("7:30 AM – 11:00 AM UTC");
    expect(formatTimeRangeTz(morning, midday, "en-US", "America/New_York")).toBe(
      "3:30 AM – 7:00 AM EDT",
    );
  });
});

/**
 * The shop-timezone contract these formatters exist to keep: a stored UTC
 * instant renders as the wall-clock time the shop published, in every season.
 *
 * These run on a UTC box (CI and production both are), which is exactly why
 * they are worth pinning — a formatter that quietly lost its `timeZone`
 * argument would render the host zone and *still* look like a valid time, just
 * four or five hours off. The zone offset is what these assert, so the
 * substitution is no longer silent.
 */
describe("rendering a stored instant in the shop's zone", () => {
  // A 7:30 AM Key Largo departure, stored as the UTC instant it really is.
  const summerDeparture = new Date("2026-07-15T11:30:00Z"); // 07:30 EDT (UTC-4)
  const winterDeparture = new Date("2026-01-15T12:30:00Z"); // 07:30 EST (UTC-5)

  it("reads back the published wall-clock hour on both sides of DST", () => {
    expect(formatTime(summerDeparture, "en-US", "America/New_York")).toBe("7:30 AM");
    expect(formatTime(winterDeparture, "en-US", "America/New_York")).toBe("7:30 AM");
  });

  it("names the zone that is actually in force, not a fixed one", () => {
    const summerEnd = new Date(summerDeparture.getTime() + 3 * 3_600_000);
    const winterEnd = new Date(winterDeparture.getTime() + 3 * 3_600_000);
    expect(formatTimeRangeTz(summerDeparture, summerEnd, "en-US", "America/New_York")).toBe(
      "7:30 AM – 10:30 AM EDT",
    );
    expect(formatTimeRangeTz(winterDeparture, winterEnd, "en-US", "America/New_York")).toBe(
      "7:30 AM – 10:30 AM EST",
    );
  });

  it("converts once — the host zone (UTC here) is never applied on top", () => {
    // If anything double-converted, the summer departure would read 3:30 AM
    // (shifted twice) rather than the 7:30 AM the shop published.
    expect(formatTime(summerDeparture, "en-US", "America/New_York")).toBe("7:30 AM");
    // And the same instant in UTC is the untranslated storage value, four
    // hours later — the reading a dropped `timeZone` argument would produce.
    expect(formatTime(summerDeparture, "en-US", "UTC")).toBe("11:30 AM");
  });

  it("keeps a night dive on the day it sails, which UTC would roll forward", () => {
    const nightDive = new Date("2026-07-16T01:00:00Z"); // 9:00 PM Jul 15 in New York
    expect(formatShortDate(nightDive, "en-US", "America/New_York")).toBe("Wed, Jul 15");
    expect(formatTime(nightDive, "en-US", "America/New_York")).toBe("9:00 PM");
    // The bug this guards: rendered in UTC it is already Thursday the 16th, so
    // the boat disappears off the day its divers are looking at.
    expect(formatShortDate(nightDive, "en-US", "UTC")).toBe("Thu, Jul 16");
  });

  it("handles a half-hour DST zone, where an hour-based fix would still be wrong", () => {
    // Australia/Lord_Howe moves the clock by THIRTY minutes: UTC+11:00 in
    // (southern) summer, UTC+10:30 in winter.
    const lordHoweSummer = new Date("2026-01-15T21:00:00Z"); // 08:00 +11:00
    const lordHoweWinter = new Date("2026-07-15T21:30:00Z"); // 08:00 +10:30
    expect(formatTime(lordHoweSummer, "en-US", "Australia/Lord_Howe")).toBe("8:00 AM");
    expect(formatTime(lordHoweWinter, "en-US", "Australia/Lord_Howe")).toBe("8:00 AM");
  });
});

describe("formatRelativeDay", () => {
  const noon = (day: string) => new Date(`${day}T12:00:00Z`);

  it("reads today/tomorrow/in N days off the calendar day, not the raw hour difference", () => {
    expect(formatRelativeDay(noon("2026-07-17"), noon("2026-07-17"), "en-US", "UTC")).toBe("today");
    expect(formatRelativeDay(noon("2026-07-18"), noon("2026-07-17"), "en-US", "UTC")).toBe(
      "tomorrow",
    );
    expect(formatRelativeDay(noon("2026-07-19"), noon("2026-07-17"), "en-US", "UTC")).toBe(
      "in 2 days",
    );
    expect(formatRelativeDay(noon("2026-07-16"), noon("2026-07-17"), "en-US", "UTC")).toBe(
      "yesterday",
    );
  });

  it("diffs by calendar day in the given timezone, so a trip just after local midnight isn't misread as two days out", () => {
    // 11pm Honolulu on the 17th is already 9am UTC on the 18th — the same
    // calendar day locally as `now`, so this must still read "today" there
    // even though the raw UTC dates differ.
    const lateNightHonolulu = new Date("2026-07-18T09:00:00Z");
    const sameEveningHonolulu = new Date("2026-07-18T05:00:00Z");
    expect(
      formatRelativeDay(lateNightHonolulu, sameEveningHonolulu, "en-US", "Pacific/Honolulu"),
    ).toBe("today");
  });

  it("localizes through Intl.RelativeTimeFormat rather than hard-coded English", () => {
    expect(formatRelativeDay(noon("2026-07-19"), noon("2026-07-17"), "es-ES", "UTC")).toBe(
      "pasado mañana",
    );
  });
});

describe("formatByteSize", () => {
  it("picks the decimal unit a storage console would report", () => {
    expect(formatByteSize(0, "en-US")).toBe("0 byte");
    expect(formatByteSize(999, "en-US")).toBe("999 byte");
    expect(formatByteSize(1_000, "en-US")).toBe("1 kB");
    expect(formatByteSize(42_300_000, "en-US")).toBe("42.3 MB");
    expect(formatByteSize(128_000_000, "en-US")).toBe("128 MB");
    expect(formatByteSize(2_500_000_000, "en-US")).toBe("2.5 GB");
  });

  it("formats for the reader's locale", () => {
    expect(formatByteSize(42_300_000, "es-ES")).toBe("42,3 MB");
  });
});

describe("formatter caching", () => {
  // Every Intl.*Format constructor here is memoized (keyed on constructor +
  // locale + options) rather than rebuilt per call — repeated, rapid,
  // interleaved calls with different locales/timezones must never bleed
  // into each other's cached instance.
  it("never cross-contaminates results across interleaved locales and timezones", () => {
    for (let i = 0; i < 3; i++) {
      expect(formatTime(morning, "en-US", "UTC")).toBe("7:30 AM");
      expect(formatTime(morning, "en-US", "America/New_York")).toBe("3:30 AM");
      expect(formatShortDate(morning, "en-US", "UTC")).toBe("Fri, Jul 17");
      expect(formatShortDate(morning, "en-US", "Pacific/Honolulu")).toBe("Thu, Jul 16");
    }
  });
});

describe("weekdayNames", () => {
  it("names the seven days Sunday first, matching the recurrence bit order", () => {
    expect(weekdayNames("en-US")).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("spells them in the reader's own language", () => {
    // The reason these are not seven keys per bundle: `Intl` already knows.
    expect(weekdayNames("es-ES")[1]).toMatch(/^lun/i);
  });

  it("is stable — it reads a fixed reference week, never the clock", () => {
    expect(weekdayNames("en-US")).toEqual(weekdayNames("en-US"));
  });
});

describe("formatOrdinal", () => {
  it("formats English ordinals correctly", () => {
    expect(formatOrdinal(1, "en-US")).toBe("1st");
    expect(formatOrdinal(2, "en-US")).toBe("2nd");
    expect(formatOrdinal(3, "en-US")).toBe("3rd");
    expect(formatOrdinal(4, "en-US")).toBe("4th");
    expect(formatOrdinal(21, "en-US")).toBe("21st");
  });

  it("formats Spanish ordinals correctly", () => {
    expect(formatOrdinal(1, "es-ES")).toBe("1.º");
    expect(formatOrdinal(4, "es-ES")).toBe("4.º");
  });
});
