import { describe, expect, it } from "vitest";
import { backupObjectKey, backupPeriodKey } from "./period";

describe("backupPeriodKey", () => {
  it("names an ordinary mid-year week", () => {
    // 2026-08-04 is a Tuesday in ISO week 32.
    expect(backupPeriodKey(new Date("2026-08-04T06:00:00Z"))).toBe("2026-W32");
  });

  it("keeps every day of one ISO week on one key", () => {
    // Monday through Sunday of ISO week 32, 2026.
    expect(backupPeriodKey(new Date("2026-08-03T00:00:00Z"))).toBe("2026-W32");
    expect(backupPeriodKey(new Date("2026-08-09T23:59:59Z"))).toBe("2026-W32");
    expect(backupPeriodKey(new Date("2026-08-10T00:00:00Z"))).toBe("2026-W33");
  });

  it("assigns the first days of January to the previous year's last week when ISO says so", () => {
    // 2027-01-01 is a Friday: it belongs to 2026's final week, W53.
    expect(backupPeriodKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(backupPeriodKey(new Date("2027-01-04T00:00:00Z"))).toBe("2027-W01");
  });

  it("assigns late December to the next year's first week when ISO says so", () => {
    // 2025-12-29 is a Monday: ISO week 1 of 2026.
    expect(backupPeriodKey(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
    expect(backupPeriodKey(new Date("2025-12-28T23:59:59Z"))).toBe("2025-W52");
  });

  it("zero-pads single-digit weeks", () => {
    expect(backupPeriodKey(new Date("2026-01-07T00:00:00Z"))).toBe("2026-W02");
  });

  it("reads the week in UTC regardless of the caller's wall clock representation", () => {
    // Sunday 23:30 UTC is still the old week even where local time is Monday.
    expect(backupPeriodKey(new Date("2026-08-09T23:30:00Z"))).toBe("2026-W32");
  });
});

describe("backupObjectKey", () => {
  it("joins a prefix with one slash however the prefix was written", () => {
    for (const prefix of ["diveday", "diveday/", "/diveday", "/diveday/"]) {
      expect(backupObjectKey(prefix, "blue-mantis", "2026-W32")).toBe(
        "diveday/diveday-backup-blue-mantis-2026-W32.zip",
      );
    }
  });

  it("lands at the bucket root when the prefix is empty", () => {
    expect(backupObjectKey("", "blue-mantis", "2026-W32")).toBe(
      "diveday-backup-blue-mantis-2026-W32.zip",
    );
  });

  it("keeps nested prefixes intact", () => {
    expect(backupObjectKey("backups/diveday", "blue-mantis", "2026-W32")).toBe(
      "backups/diveday/diveday-backup-blue-mantis-2026-W32.zip",
    );
  });

  it("is deterministic for a period, so a retried week overwrites its own object", () => {
    const first = backupObjectKey("diveday", "blue-mantis", "2026-W32");
    expect(backupObjectKey("diveday", "blue-mantis", "2026-W32")).toBe(first);
  });
});
