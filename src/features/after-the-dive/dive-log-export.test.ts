import { describe, expect, it } from "vitest";
import {
  type DiveLogEntry,
  diveLogCsv,
  diveLogFileName,
  diveLogFormat,
  diveLogUddf,
} from "./dive-log-export";

const entry: DiveLogEntry = {
  shopName: "Blue Mantis",
  tripTitle: "Two-tank reef",
  // 13:30Z is 09:30 in New York in October.
  startsAt: new Date("2026-10-03T13:30:00Z"),
  timeZone: "America/New_York",
  siteNames: ["French Reef", "Molasses"],
  waterTemperatureC: 27,
  visibilityMeters: 18,
  surfaceConditions: "Calm",
};

describe("the dive log entry file", () => {
  it("writes one CSV row dated in the shop's zone", () => {
    expect(diveLogCsv(entry)).toBe(
      "date,start_time,time_zone,shop,trip,sites,water_temperature_c,visibility_m,surface_conditions\r\n" +
        "2026-10-03,09:30,America/New_York,Blue Mantis,Two-tank reef,French Reef; Molasses,27,18,Calm\r\n",
    );
  });

  it("leaves unrecorded conditions empty and never invents a depth or time", () => {
    const csv = diveLogCsv({
      ...entry,
      waterTemperatureC: null,
      visibilityMeters: null,
      surfaceConditions: null,
      siteNames: [],
    });
    expect(csv.split("\r\n")[1]).toBe(
      "2026-10-03,09:30,America/New_York,Blue Mantis,Two-tank reef,,,,",
    );
    expect(csv).not.toMatch(/depth|bottom/i);
  });

  it("neutralises a spreadsheet formula in a shop-written cell", () => {
    expect(diveLogCsv({ ...entry, tripTitle: "=HYPERLINK(1)" })).toContain("'=HYPERLINK(1)");
  });

  it("writes a UDDF dive that links its sites and carries the conditions as notes", () => {
    const uddf = diveLogUddf(entry, new Date("2026-10-04T00:00:00Z"));
    expect(uddf).toContain('<uddf version="3.2.3"');
    expect(uddf).toContain('<site id="site1"><name>French Reef</name></site>');
    expect(uddf).toContain("<datetime>2026-10-03T09:30:00</datetime>");
    expect(uddf).toContain('<link ref="site2"/>');
    expect(uddf).toContain("<para>Water temperature: 27 C</para>");
    expect(uddf).not.toContain("<samples");
  });

  it("escapes markup in names", () => {
    const uddf = diveLogUddf(
      { ...entry, siteNames: ['A & "B" <c>'] },
      new Date("2026-10-04T00:00:00Z"),
    );
    expect(uddf).toContain("A &amp; &quot;B&quot; &lt;c&gt;");
    expect(uddf).not.toContain("<c>");
  });

  it("names the file by trip and day, and refuses any other format", () => {
    expect(diveLogFileName(entry, "uddf")).toBe("two-tank-reef-2026-10-03.uddf");
    expect(diveLogFormat("csv")).toBe("csv");
    expect(diveLogFormat("xlsx")).toBeNull();
    expect(diveLogFormat(null)).toBeNull();
  });
});
