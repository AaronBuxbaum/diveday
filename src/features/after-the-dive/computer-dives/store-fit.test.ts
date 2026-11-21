import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { computerDives, people } from "@/db/schema";
import { unseededTestDb } from "@/test/db";
import { commitComputerFiles, historyComputerDives, previewComputerFiles } from "./store";
import { computerFixture, selectedInput } from "./test-support";

const fitFile = () => ({
  name: "garmin.fit",
  bytes: new Uint8Array(
    readFileSync(
      new URL(
        "../../../lib/computer-import/fixtures/garmin-connect-summary-first.fit",
        import.meta.url,
      ),
    ),
  ),
});

describe("FIT personal history integration", () => {
  it("preserves a known instant without inventing wall time and refuses offset reinterpretation", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const files = [fitFile()];
    const preview = await previewComputerFiles(db, scope, files);
    expect(preview.files[0].error).toBeNull();
    expect(preview.dives).toHaveLength(1);
    expect(preview.dives[0].record.localStart).toBeNull();
    expect(preview.dives[0].record.startInstant).toMatch(/Z$/);
    const input = await selectedInput(db, scope, files);
    await expect(
      commitComputerFiles(db, scope, {
        ...input,
        timeOffsets: Object.fromEntries(input.selectedKeys.map((key) => [key, 60])),
      }),
    ).rejects.toThrow("invalid_timezone");
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    const [saved] = (await historyComputerDives(db, scope)).dives;
    expect(saved.record).toEqual(preview.dives[0].record);
    expect((await previewComputerFiles(db, scope, files)).dives[0].duplicate).toBe("exact");
    const [person] = await db.select().from(people).where(eq(people.id, scope.personId));
    expect(person.lastDiveOn).toBeNull();
  });
});

it("matches known instants for possible duplicates without treating every absent local clock alike", async () => {
  const db = await unseededTestDb();
  const scope = await computerFixture(db);
  await commitComputerFiles(db, scope, await selectedInput(db, scope));
  const [existing] = (await historyComputerDives(db, scope)).dives;
  const files = [fitFile()];
  const [candidate] = (await previewComputerFiles(db, scope, files)).dives;
  await db
    .update(computerDives)
    .set({
      record: { ...existing.record, localStart: null, startInstant: "2026-06-01T00:00:00.000Z" },
    })
    .where(eq(computerDives.id, existing.id));
  expect((await previewComputerFiles(db, scope, files)).dives[0].duplicate).toBeNull();
  await db
    .update(computerDives)
    .set({
      record: { ...existing.record, localStart: null, startInstant: candidate.record.startInstant },
    })
    .where(eq(computerDives.id, existing.id));
  expect((await previewComputerFiles(db, scope, files)).dives[0].duplicate).toBe("possible");
});
