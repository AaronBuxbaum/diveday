import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { readActiveStaffRoles } from "@/db/authz";
import type { AppDb, DbExecutor } from "@/db/client";
import {
  computerDiveProfiles,
  computerDives,
  computerImportBatches,
  people,
  personRoles,
  userAccounts,
} from "@/db/schema";
import { livePerson } from "@/db/trips";
import { canExportShopData, isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { type ParsedComputerDive, parseComputerFile } from "@/lib/computer-import";

export type ComputerScope = { shopId: string; personId: string; actorPersonId: string };
export type ComputerFile = { name: string; bytes: Uint8Array };
export type PreviewDive = {
  key: string;
  fingerprint: string;
  record: ParsedComputerDive;
  duplicate: "exact" | "possible" | null;
};
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const scopeWhere = (scope: ComputerScope) =>
  and(eq(computerDives.shopId, scope.shopId), eq(computerDives.personId, scope.personId));

/** Locks serialize imports with erasure, merge and account/role revocation. */
async function authorize(db: DbExecutor, scope: ComputerScope, lock = false) {
  // Staff removal and legal erasure take account locks before person locks.
  if (lock) {
    await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.personId, scope.actorPersonId))
      .for("share");
  }
  const query = db
    .select()
    .from(people)
    .where(
      and(
        eq(people.shopId, scope.shopId),
        livePerson(),
        inArray(people.id, [...new Set([scope.personId, scope.actorPersonId])]),
      ),
    )
    .orderBy(asc(people.id));
  const rows = await (lock ? query.for("update") : query);
  const person = rows.find((row) => row.id === scope.personId);
  const actor = rows.find((row) => row.id === scope.actorPersonId);
  if (!person || person.deletedAt || person.anonymizedAt) throw new Error("not_found");
  if (!actor || actor.deletedAt || actor.anonymizedAt) throw new Error("not_authorized");
  if (lock) {
    await db
      .select()
      .from(personRoles)
      .where(eq(personRoles.personId, scope.actorPersonId))
      .for("share");
  }
  const roles = await readActiveStaffRoles(db, scope.shopId, scope.actorPersonId);
  if (!isStaff(roles ?? undefined)) throw new Error("not_authorized");
  return person;
}

function parseFiles(files: ComputerFile[]) {
  if (
    !Array.isArray(files) ||
    files.length < 1 ||
    files.length > 10 ||
    files.reduce((sum, file) => sum + file.bytes.length, 0) > 10 * 1024 * 1024
  )
    throw new Error("invalid_file");
  const dives: Omit<PreviewDive, "duplicate">[] = [];
  const results = files.map((file, fileIndex) => {
    if (!(file.bytes instanceof Uint8Array)) throw new Error("invalid_file");
    try {
      const records = parseComputerFile(file.bytes);
      const fileHash = digest(file.bytes);
      records.forEach((record, index) => {
        dives.push({
          key: `${fileHash}:${fileIndex}:${index}`,
          fingerprint: digest(JSON.stringify(record)),
          record,
        });
      });
      return { name: file.name.slice(0, 200), error: null as string | null };
    } catch (error) {
      return {
        name: file.name.slice(0, 200),
        error: error instanceof Error ? error.message : "invalid_file",
      };
    }
  });
  if (dives.length > 500) throw new Error("too_many_dives");
  return { files: results, dives };
}

export async function previewComputerFiles(db: AppDb, scope: ComputerScope, files: ComputerFile[]) {
  const person = await authorize(db, scope);
  const parsed = parseFiles(files);
  const existing = await db
    .select({ fingerprint: computerDives.fingerprint, record: computerDives.record })
    .from(computerDives)
    .where(scopeWhere(scope));
  const seen = new Set(existing.map((row) => row.fingerprint));
  const dives: PreviewDive[] = parsed.dives.map((dive) => {
    const duplicate = seen.has(dive.fingerprint)
      ? "exact"
      : existing.some((row) => row.record.localStart === dive.record.localStart)
        ? "possible"
        : null;
    seen.add(dive.fingerprint);
    return { ...dive, duplicate };
  });
  return { personName: person.fullName, files: parsed.files, dives };
}

export type CommitComputerInput = {
  files: ComputerFile[];
  selectedKeys: string[];
  requestKey: string;
  confirmedPersonId: string;
  timeOffsets?: Record<string, number | null>;
};
export async function commitComputerFiles(
  db: AppDb,
  scope: ComputerScope,
  input: CommitComputerInput,
) {
  if (
    input.confirmedPersonId !== scope.personId ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey) ||
    !Array.isArray(input.selectedKeys) ||
    input.selectedKeys.length === 0
  )
    throw new Error("invalid_selection");
  const parsed = parseFiles(input.files);
  const byKey = new Map(parsed.dives.map((dive) => [dive.key, dive]));
  const selected = [...new Set(input.selectedKeys)].sort().map((key) => {
    const dive = byKey.get(key);
    if (!dive || !input.timeOffsets || !Object.hasOwn(input.timeOffsets, key))
      throw new Error("invalid_selection");
    const offset = input.timeOffsets[key];
    if (offset !== null && (!Number.isInteger(offset) || Math.abs(offset) > 840))
      throw new Error("invalid_timezone");
    let record = dive.record;
    if (offset !== null) {
      if (record.offsetMinutes !== null && record.offsetMinutes !== offset)
        throw new Error("invalid_timezone");
      const wall = record.localStart.replace(/(?:Z|[+-]\d\d:\d\d)$/, "");
      const ms = Date.parse(`${wall}Z`);
      if (!Number.isFinite(ms)) throw new Error("invalid_timezone");
      record = {
        ...record,
        offsetMinutes: offset,
        startInstant: new Date(ms - offset * 60000).toISOString(),
      };
    }
    return { key, record, fingerprint: dive.fingerprint };
  });
  const selectionHash = digest(JSON.stringify(selected));
  return db.transaction(async (tx) => {
    await authorize(tx, scope, true);
    const [prior] = await tx
      .select()
      .from(computerImportBatches)
      .where(
        and(
          eq(computerImportBatches.shopId, scope.shopId),
          eq(computerImportBatches.personId, scope.personId),
          eq(computerImportBatches.requestKey, input.requestKey),
        ),
      );
    if (prior) {
      if (prior.selectionHash !== selectionHash) throw new Error("request_conflict");
      return { imported: prior.importedCount, skipped: prior.skippedCount };
    }
    const [batch] = await tx
      .insert(computerImportBatches)
      .values({
        shopId: scope.shopId,
        personId: scope.personId,
        requestKey: input.requestKey,
        selectionHash,
        importedCount: 0,
        skippedCount: 0,
      })
      .returning();
    let imported = 0;
    for (const dive of selected) {
      const { samples, ...record } = dive.record;
      const [row] = await tx
        .insert(computerDives)
        .values({
          shopId: scope.shopId,
          personId: scope.personId,
          batchId: batch.id,
          fingerprint: dive.fingerprint,
          record,
        })
        .onConflictDoNothing()
        .returning({ id: computerDives.id });
      if (!row) continue;
      if (samples.length)
        await tx
          .insert(computerDiveProfiles)
          .values({ shopId: scope.shopId, personId: scope.personId, diveId: row.id, samples });
      imported++;
    }
    const result = { imported, skipped: selected.length - imported };
    await tx
      .update(computerImportBatches)
      .set({ importedCount: result.imported, skippedCount: result.skipped })
      .where(
        and(eq(computerImportBatches.id, batch.id), eq(computerImportBatches.shopId, scope.shopId)),
      );
    return result;
  });
}

export async function historyComputerDives(db: AppDb, scope: ComputerScope) {
  const person = await authorize(db, scope);
  const roles = await readActiveStaffRoles(db, scope.shopId, scope.actorPersonId);
  return {
    ...(await readHistory(db, scope, person.fullName)),
    canExport: canExportShopData(roles ?? undefined),
  };
}
async function readHistory(db: DbExecutor, scope: ComputerScope, personName: string) {
  const rows = await db
    .select({ dive: computerDives, samples: computerDiveProfiles.samples })
    .from(computerDives)
    .leftJoin(
      computerDiveProfiles,
      and(
        eq(computerDiveProfiles.diveId, computerDives.id),
        eq(computerDiveProfiles.shopId, scope.shopId),
        eq(computerDiveProfiles.personId, scope.personId),
      ),
    )
    .where(scopeWhere(scope))
    .orderBy(
      sql`${computerDives.record}->>'localStart'`,
      asc(computerDives.fingerprint),
      asc(computerDives.id),
    );
  return {
    personName,
    dives: rows.map(({ dive, samples }) => ({
      id: dive.id,
      record: { ...dive.record, samples: samples ?? [] } as unknown as ParsedComputerDive,
      annotation: dive.annotation,
      deletedAt: dive.deletedAt,
    })),
  };
}
async function changeDive(
  db: AppDb,
  scope: ComputerScope,
  id: string,
  values: { annotation?: string; deletedAt?: Date | null },
) {
  await db.transaction(async (tx) => {
    await authorize(tx, scope, true);
    const rows = await tx
      .update(computerDives)
      .set(values)
      .where(and(scopeWhere(scope), eq(computerDives.id, id)))
      .returning({ id: computerDives.id });
    if (!rows.length) throw new Error("not_found");
  });
}
export async function annotateComputerDive(
  db: AppDb,
  scope: ComputerScope,
  id: string,
  note: string,
) {
  if (typeof note !== "string" || note.length > 2000) throw new Error("invalid_note");
  return changeDive(db, scope, id, { annotation: note });
}
export async function deleteComputerDive(db: AppDb, scope: ComputerScope, id: string) {
  return changeDive(db, scope, id, { deletedAt: nowDate() });
}
export async function restoreComputerDive(db: AppDb, scope: ComputerScope, id: string) {
  return changeDive(db, scope, id, { deletedAt: null });
}
export async function exportComputerDives(db: AppDb, scope: ComputerScope) {
  return db.transaction(async (tx) => {
    const person = await authorize(tx, scope, true);
    const roles = await readActiveStaffRoles(tx, scope.shopId, scope.actorPersonId);
    if (!canExportShopData(roles ?? undefined)) throw new Error("not_authorized");
    return JSON.stringify(await readHistory(tx, scope, person.fullName));
  });
}
