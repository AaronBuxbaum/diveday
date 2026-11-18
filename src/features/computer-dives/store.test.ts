import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "@/db/people";
import {
  computerDiveProfiles,
  computerDives,
  computerImportBatches,
  people,
  personRoles,
} from "@/db/schema";
import { unseededTestDb } from "@/test/db";
import {
  annotateComputerDive,
  commitComputerFiles,
  countComputerDives,
  deleteComputerDive,
  exportComputerDives,
  historyComputerDives,
  previewComputerFiles,
  recapComputerDives,
  restoreComputerDive,
} from "./store";

import { computerFixture, file, selectedInput } from "./test-support";

describe("personal computer import", () => {
  it("previews without saving, commits and returns the same receipt after a lost response", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const input = await selectedInput(db, scope);
    const repeated = await previewComputerFiles(db, scope, [file(), file()]);
    expect(new Set(repeated.dives.map((d) => d.key)).size).toBe(2);
    expect(repeated.dives.map((d) => d.duplicate)).toEqual([null, "exact"]);
    expect(await db.select().from(computerDives)).toEqual([]);
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    expect(await commitComputerFiles(db, scope, input)).toEqual({ imported: 1, skipped: 0 });
    expect(await db.select().from(computerImportBatches)).toHaveLength(1);
    const history = await historyComputerDives(db, scope);
    expect(history.dives[0].record.startInstant).toBeNull();
    expect(history.dives[0].record.localStart).toContain("23:50");
    const [person] = await db.select().from(people).where(eq(people.id, scope.personId));
    expect(person.lastDiveOn).toBeNull();
  });
  it("keeps deletion reversible, annotation separate and removed imports deduplicated", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    await commitComputerFiles(db, scope, await selectedInput(db, scope));
    const {
      dives: [dive],
    } = await historyComputerDives(db, scope);
    await annotateComputerDive(db, scope, dive.id, "Correct site: North Reef");
    await deleteComputerDive(db, scope, dive.id);
    expect((await historyComputerDives(db, scope)).dives[0].deletedAt).not.toBeNull();
    expect(await commitComputerFiles(db, scope, await selectedInput(db, scope))).toEqual({
      imported: 0,
      skipped: 1,
    });
    await restoreComputerDive(db, scope, dive.id);
    const restored = (await historyComputerDives(db, scope)).dives[0];
    expect(restored.annotation).toBe("Correct site: North Reef");
    expect(restored.record).toEqual(dive.record);
    expect(restored.deletedAt).toBeNull();
    expect(JSON.parse(await exportComputerDives(db, scope)).dives).toHaveLength(1);
  });
  it("counts a diver's live dives for the file's row, not the deleted ones", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    expect(await countComputerDives(db, scope)).toBe(0);
    await commitComputerFiles(db, scope, await selectedInput(db, scope));
    expect(await countComputerDives(db, scope)).toBe(1);
    const {
      dives: [dive],
    } = await historyComputerDives(db, scope);
    await deleteComputerDive(db, scope, dive.id);
    expect(await countComputerDives(db, scope)).toBe(0);
  });
  it("scopes exact and possible duplicates to the person and refuses changed retry intent", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const input = await selectedInput(db, scope);
    await commitComputerFiles(db, scope, input);
    expect((await previewComputerFiles(db, scope, [file()])).dives[0].duplicate).toBe("exact");
    expect((await previewComputerFiles(db, scope, [file("two", "21")])).dives[0].duplicate).toBe(
      "possible",
    );
    const other = await computerFixture(db);
    expect((await previewComputerFiles(db, other, [file()])).dives[0].duplicate).toBeNull();
    await expect(
      commitComputerFiles(db, scope, {
        ...(await selectedInput(db, scope, [file("two")])),
        requestKey: input.requestKey,
      }),
    ).rejects.toThrow("request_conflict");
  });
  it("refuses erasure, deletion or role revocation after preview and rejects cross-tenant writes", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const input = await selectedInput(db, scope);
    const other = await computerFixture(db);
    await expect(
      commitComputerFiles(db, { ...scope, shopId: other.shopId }, input),
    ).rejects.toThrow("not_found");
    await db.delete(personRoles).where(eq(personRoles.personId, scope.actorPersonId));
    await expect(commitComputerFiles(db, scope, input)).rejects.toThrow("not_authorized");
    expect(await db.select().from(computerDives)).toEqual([]);
    await db.insert(personRoles).values({ personId: scope.actorPersonId, role: "owner" });
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-01-02T00:00:00Z") })
      .where(eq(people.id, scope.personId));
    await expect(commitComputerFiles(db, scope, input)).rejects.toThrow("not_found");
  });
  it("requires timezone choice and target confirmation; explicit offset preserves wall time across midnight", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const input = await selectedInput(db, scope);
    await expect(commitComputerFiles(db, scope, { ...input, timeOffsets: {} })).rejects.toThrow(
      "invalid_selection",
    );
    await expect(
      commitComputerFiles(db, scope, { ...input, confirmedPersonId: randomUUID() }),
    ).rejects.toThrow("invalid_selection");
    await commitComputerFiles(db, scope, {
      ...input,
      timeOffsets: Object.fromEntries(input.selectedKeys.map((k) => [k, -300])),
    });
    const {
      dives: [d],
    } = await historyComputerDives(db, scope);
    expect(d.record.startInstant).toBe("2026-01-02T04:50:00.000Z");
    expect(d.record.localStart).toContain("2026-01-01T23:50");
    expect((await previewComputerFiles(db, scope, [file()])).dives[0].duplicate).toBe("exact");
  });
});

describe("a diver's recap reads their own computer's dives for the trip day", () => {
  it("returns the live dives logged that day for that diver, and nothing for another day or person", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    await commitComputerFiles(db, scope, await selectedInput(db, scope));
    const day = {
      shopId: scope.shopId,
      personId: scope.personId,
      crewPersonIds: [],
      timeZone: "UTC",
    };
    const found = await recapComputerDives(db, { ...day, date: "2026-01-01" });
    expect(found.dives).toHaveLength(1);
    expect(found.dives[0]).toMatchObject({
      device: "Computer",
      durationSeconds: 1800,
      maxDepthMeters: 20,
    });
    expect((await recapComputerDives(db, { ...day, date: "2026-01-02" })).dives).toEqual([]);
    expect(
      (await recapComputerDives(db, { ...day, personId: randomUUID(), date: "2026-01-01" })).dives,
    ).toEqual([]);
    const {
      dives: [dive],
    } = await historyComputerDives(db, scope);
    await deleteComputerDive(db, scope, dive.id);
    expect((await recapComputerDives(db, { ...day, date: "2026-01-01" })).dives).toEqual([]);
  });

  it("does not expose a crew member's recording, even with a profile", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const guide = await createPerson(db, {
      shopId: scope.shopId,
      fullName: "Guide",
      email: null,
      phone: null,
      origin: "seed",
    });
    const guideScope = { ...scope, personId: guide.id };
    await commitComputerFiles(db, guideScope, await selectedInput(db, guideScope));
    const [row] = await db.select().from(computerDives).where(eq(computerDives.personId, guide.id));
    const input = {
      shopId: scope.shopId,
      personId: scope.personId,
      crewPersonIds: [guide.id],
      date: "2026-01-01",
      timeZone: "UTC",
    };
    // No profile yet: nothing to show of the guide's.
    expect((await recapComputerDives(db, input)).dives).toEqual([]);
    await db.insert(computerDiveProfiles).values({
      shopId: scope.shopId,
      personId: guide.id,
      diveId: row.id,
      samples: [
        { seconds: 0, depthMeters: 0 },
        { seconds: 60, depthMeters: 12 },
        { seconds: 120, depthMeters: 0 },
      ],
    });
    const found = await recapComputerDives(db, input);
    expect(found.dives).toEqual([]);
    // The diver's own recording wins once they have one.
    await commitComputerFiles(db, scope, await selectedInput(db, scope));
    expect((await recapComputerDives(db, input)).dives[0]?.device).toBe("Computer");
  });
});
