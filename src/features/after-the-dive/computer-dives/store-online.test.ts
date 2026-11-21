import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { computerImportBatches, people, personRoles } from "@/db/schema";
import { unseededTestDb } from "@/test/db";
import {
  commitComputerFiles,
  exportComputerDiveSummaryCsv,
  exportComputerDives,
  historyComputerDives,
  previewComputerFiles,
} from "./store";
import { computerFixture, file, selectedInput } from "./test-support";

const dateMapping = {
  columns: { date: "Date", duration: "Minutes", maxDepth: "Feet" },
  dateFormat: "dmy" as const,
  durationUnit: "minutes" as const,
  depthUnit: "ft" as const,
};

describe("beta online-logbook provenance", () => {
  it("keeps a chosen provider as beta provenance without changing exact identity", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const files = [file()];
    const original = await previewComputerFiles(db, scope, files);
    const preview = await previewComputerFiles(db, scope, files, { provider: "padi" });
    expect(preview.dives[0].record.importSource).toEqual({ provider: "padi", beta: true });
    expect(preview.dives[0].fingerprint).toBe(original.dives[0].fingerprint);
    const input = {
      ...(await selectedInput(db, scope, files)),
      options: { provider: "padi" as const },
    };
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    const history = await historyComputerDives(db, scope);
    expect(history.dives[0].record.importSource).toEqual({ provider: "padi", beta: true });
    expect((await previewComputerFiles(db, scope, files)).dives[0].duplicate).toBe("exact");
    expect(
      (await previewComputerFiles(db, scope, files, { provider: "ssi" })).dives[0].duplicate,
    ).toBe("exact");
    await expect(
      commitComputerFiles(db, scope, { ...input, options: { provider: "ssi" } }),
    ).rejects.toThrow("request_conflict");
    expect(JSON.parse(await exportComputerDives(db, scope)).dives[0].record.importSource).toEqual({
      provider: "padi",
      beta: true,
    });
  });

  it("rejects forged provenance and malformed options, including on non-CSV files", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    for (const options of [
      null,
      [],
      { provider: "constructor" },
      { provider: "padi", beta: false },
      { csvMapping: {} },
    ]) {
      await expect(previewComputerFiles(db, scope, [file()], options as never)).rejects.toThrow();
    }
    expect(await db.select().from(computerImportBatches)).toHaveLength(0);
  });

  it("deduplicates an extracted file after ZIP import without discarding archive provenance", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const plain = file();
    const archive = {
      name: "logbook.zip",
      bytes: zipSync({ "exports/log.csv": plain.bytes, "readme.txt": strToU8("attachment") }),
    };
    const preview = await previewComputerFiles(db, scope, [archive], { provider: "oceanic" });
    expect(preview.files[0].error).toBeNull();
    expect(preview.dives[0].record.archiveEntry).toBe("exports/log.csv");
    expect(preview.dives[0].record.archiveIgnoredEntries).toBe(1);
    const input = {
      files: [archive],
      selectedKeys: preview.dives.map((d) => d.key),
      requestKey: randomUUID(),
      confirmedPersonId: scope.personId,
      timeOffsets: Object.fromEntries(preview.dives.map((d) => [d.key, null])),
      options: { provider: "oceanic" as const },
    };
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    expect((await previewComputerFiles(db, scope, [plain])).dives[0].duplicate).toBe("exact");
    const [saved] = (await historyComputerDives(db, scope)).dives;
    expect(saved.record.archiveEntry).toBe("exports/log.csv");
    const [person] = await db.select().from(people).where(eq(people.id, scope.personId));
    expect(person.lastDiveOn).toBeNull();
  });

  it("authorizes summary CSV export with the same live scope and role as the full backup", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    await commitComputerFiles(db, scope, await selectedInput(db, scope));
    const csv = await exportComputerDiveSummaryCsv(db, scope);
    expect(csv).toContain("duration_seconds");
    expect(csv).toContain("1800");
    const other = await computerFixture(db);
    await expect(
      exportComputerDiveSummaryCsv(db, { ...scope, shopId: other.shopId }),
    ).rejects.toThrow();
    await db.delete(personRoles).where(eq(personRoles.personId, scope.actorPersonId));
    await expect(exportComputerDiveSummaryCsv(db, scope)).rejects.toThrow("not_authorized");
  });

  it("keeps indistinguishable date-only rows separate and reimports their own evidence exactly", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const raw = strToU8("Date,Minutes,Feet\n01/11/2026,45,60\n01/11/2026,45,60\n");
    const files = [{ name: "manual.csv", bytes: raw }];
    const options = { provider: "ssi" as const, csvMapping: dateMapping };
    const preview = await previewComputerFiles(db, scope, files, options);
    expect(preview.files[0].error).toBeNull();
    expect(preview.dives).toHaveLength(2);
    expect(new Set(preview.dives.map((d) => d.fingerprint)).size).toBe(2);
    expect(preview.dives.map((d) => d.duplicate)).toEqual([null, "possible"]);
    const input = {
      files,
      options,
      selectedKeys: preview.dives.map((d) => d.key),
      requestKey: randomUUID(),
      confirmedPersonId: scope.personId,
      timeOffsets: Object.fromEntries(preview.dives.map((d) => [d.key, null])),
    };
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 2, skipped: 0 });
    const saved = (await historyComputerDives(db, scope)).dives;
    expect(
      saved.every(
        (d) =>
          d.record.localStart === null &&
          d.record.startInstant === null &&
          d.record.localDate === "2026-11-01",
      ),
    ).toBe(true);
    expect(saved[0].record.durationSeconds).toBe(2700);
    expect(saved[0].record.maxDepthMeters).toBeCloseTo(18.288);
    expect(saved.every((d) => d.record.importSource?.provider === "ssi")).toBe(true);
    expect(
      (await previewComputerFiles(db, scope, files, options)).dives.map((d) => d.duplicate),
    ).toEqual(["exact", "exact"]);
    const archive = {
      name: "manual.zip",
      bytes: zipSync({ "before.csv": file("other").bytes, "manual.csv": raw }),
    };
    const zipped = await previewComputerFiles(db, scope, [archive], options);
    expect(zipped.files[0].error).toBeNull();
    expect(zipped.dives[0].record.durationSeconds).toBe(1800);
    expect(zipped.dives[0].record.sourceUnits.depth).toBe("m");
    expect(zipped.dives[0].record.csvMapping).toBeUndefined();
    expect(zipped.dives.slice(1).map((d) => d.duplicate)).toEqual(["exact", "exact"]);
    const before = strToU8("Date,Minutes,Feet\n02/11/2026,20,10\n");
    const validArchive = {
      name: "manual.zip",
      bytes: zipSync({ "before.csv": before, "manual.csv": raw }),
    };
    const zippedValid = await previewComputerFiles(db, scope, [validArchive], options);
    expect(zippedValid.files[0].error).toBeNull();
    expect(zippedValid.dives.slice(1).map((d) => d.duplicate)).toEqual(["exact", "exact"]);
    const differentBytes = [
      { name: "other.csv", bytes: strToU8("Date,Minutes,Feet\n01/11/2026,46,60\n") },
    ];
    expect(
      (await previewComputerFiles(db, scope, differentBytes, options)).dives[0].duplicate,
    ).toBe("possible");
  });

  it("binds mapping to an idempotency receipt and leaves missing-time offsets unknown", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const files = [{ name: "manual.csv", bytes: strToU8("Date,Minutes,Feet\n01/11/2026,45,60\n") }];
    const options = { provider: "padi" as const, csvMapping: dateMapping };
    const preview = await previewComputerFiles(db, scope, files, options);
    const key = preview.dives[0].key;
    const input = {
      files,
      options,
      selectedKeys: [key],
      requestKey: randomUUID(),
      confirmedPersonId: scope.personId,
      timeOffsets: { [key]: null },
    };
    await expect(
      commitComputerFiles(db, scope, { ...input, timeOffsets: { [key]: 0 } }),
    ).rejects.toThrow("invalid_timezone");
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    await expect(
      commitComputerFiles(db, scope, {
        ...input,
        options: { ...options, csvMapping: { ...dateMapping, depthUnit: "m" } },
      }),
    ).rejects.toThrow("request_conflict");
  });
});
