import { describe, expect, it } from "vitest";
import {
  backupObjectKey,
  backupPeriodKey,
  backupRunDate,
  parsePlatformBackupCensusKey,
  platformBackupCensusKey,
  platformBackupObjectKey,
} from "./period";

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

describe("backupRunDate", () => {
  it("is the UTC calendar date, which is what a platform run is filed under", () => {
    expect(backupRunDate(new Date("2026-08-12T05:00:00Z"))).toBe("2026-08-12");
  });

  it("reads the UTC date, not the host's — a late-evening run must not file itself tomorrow", () => {
    expect(backupRunDate(new Date("2026-08-12T23:59:59Z"))).toBe("2026-08-12");
    expect(backupRunDate(new Date("2026-08-13T00:00:00Z"))).toBe("2026-08-13");
  });
});

describe("platformBackupObjectKey", () => {
  it("files a whole run under one date prefix", () => {
    expect(platformBackupObjectKey("2026-08-12", "blue-mantis")).toBe(
      "exports/2026-08-12/blue-mantis.zip",
    );
  });

  // The layout the freshness watchdog depends on: a single ListObjectsV2 with
  // delimiter "/" returns run dates as common prefixes, and ISO dates sort
  // lexicographically into chronological order.
  it("sorts lexicographically into chronological order", () => {
    const keys = ["2026-01-05", "2026-08-12", "2026-08-02", "2025-12-31"].map((date) =>
      platformBackupObjectKey(date, "blue-mantis"),
    );
    expect([...keys].sort()).toEqual([
      "exports/2025-12-31/blue-mantis.zip",
      "exports/2026-01-05/blue-mantis.zip",
      "exports/2026-08-02/blue-mantis.zip",
      "exports/2026-08-12/blue-mantis.zip",
    ]);
  });

  it("is deterministic, so a re-run overwrites its own object", () => {
    expect(platformBackupObjectKey("2026-08-12", "blue-mantis")).toBe(
      platformBackupObjectKey("2026-08-12", "blue-mantis"),
    );
  });
});

/**
 * The census key is a *contract with a principal that cannot open objects*.
 *
 * The freshness watchdog (infra S19) holds `s3:ListBucket` and deliberately
 * nothing else — `infra/lib/backup-freshness.test.ts` has a test whose whole
 * job is to keep it that way — so the only thing it can learn about a run is
 * what the key names say. These tests pin the shape the watchdog's inline
 * Lambda parses; `infra/lib/backup-freshness.test.ts` asserts that Lambda's
 * regex against this same format, so the two cannot drift apart silently.
 */
describe("platformBackupCensusKey", () => {
  it("files the census beside the run's bundles, with the counts in the name", () => {
    expect(
      platformBackupCensusKey("2026-08-14", { shops: 40, stored: 25, failed: 0, skipped: 15 }),
    ).toBe("exports/2026-08-14/_run.shops-40.stored-25.failed-0.skipped-15");
  });

  it("shares the run prefix with the bundles, so one listing sees both", () => {
    const runDate = "2026-08-14";
    const census = platformBackupCensusKey(runDate, {
      shops: 1,
      stored: 1,
      failed: 0,
      skipped: 0,
    });
    const bundle = platformBackupObjectKey(runDate, "blue-mantis");
    expect(census.slice(0, census.lastIndexOf("/"))).toBe(bundle.slice(0, bundle.lastIndexOf("/")));
  });

  it("sorts above a letter-initial slug, which is what a console listing mostly holds", () => {
    // Legibility only — the watchdog finds the census by pattern, never by
    // position. Worth pinning the true claim rather than the tempting one: `_`
    // is 0x5F, so it beats every letter and loses to every digit. A shop called
    // "3 Amigos Diving" files above the census, and that is fine.
    const runDate = "2026-08-14";
    const census = platformBackupCensusKey(runDate, { shops: 2, stored: 2, failed: 0, skipped: 0 });
    for (const slug of ["aqua", "blue-mantis", "zebra-divers"]) {
      expect([census, platformBackupObjectKey(runDate, slug)].sort()[0]).toBe(census);
    }
    expect([census, platformBackupObjectKey(runDate, "0-first")].sort()[0]).not.toBe(census);
  });

  it("is never mistaken for a bundle", () => {
    const key = platformBackupCensusKey("2026-08-14", {
      shops: 3,
      stored: 3,
      failed: 0,
      skipped: 0,
    });
    // The watchdog counts `.zip` keys as bundles; a census that ended in one
    // would inflate the very number it exists to check.
    expect(key.endsWith(".zip")).toBe(false);
  });
});

describe("parsePlatformBackupCensusKey", () => {
  it("round-trips every count", () => {
    const census = { shops: 40, stored: 25, failed: 2, skipped: 13 };
    expect(parsePlatformBackupCensusKey(platformBackupCensusKey("2026-08-14", census))).toEqual(
      census,
    );
  });

  it("reads a complete run as covering everything", () => {
    const census = { shops: 7, stored: 7, failed: 0, skipped: 0 };
    const parsed = parsePlatformBackupCensusKey(platformBackupCensusKey("2026-08-14", census));
    expect(parsed?.skipped).toBe(0);
    expect(parsed?.stored).toBe(parsed?.shops);
  });

  it("handles counts of more than one digit, which is the case that matters", () => {
    // The whole failure this guards against only appears once the estate is
    // large enough not to fit the slot, so a single-digit-only regex would pass
    // every test and fail in exactly the situation it was written for.
    const census = { shops: 128, stored: 96, failed: 0, skipped: 32 };
    expect(parsePlatformBackupCensusKey(platformBackupCensusKey("2026-08-14", census))).toEqual(
      census,
    );
  });

  it("answers null for a bundle, a prefix, and an empty string", () => {
    expect(parsePlatformBackupCensusKey(platformBackupObjectKey("2026-08-14", "blue-mantis"))).toBe(
      null,
    );
    expect(parsePlatformBackupCensusKey("exports/2026-08-14/")).toBe(null);
    expect(parsePlatformBackupCensusKey("")).toBe(null);
  });

  it("answers null for a truncated census rather than guessing a zero", () => {
    // A partial key must not read as "0 skipped" — that is the exact reading
    // that would turn this alarm off in the situation it exists for.
    expect(parsePlatformBackupCensusKey("exports/2026-08-14/_run.shops-40.stored-25")).toBe(null);
  });
});
