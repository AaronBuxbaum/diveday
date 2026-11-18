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
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  type ComputerLogbookProvider,
  type ComputerParseOptions,
  isComputerLogbookProvider,
  type ParsedComputerDive,
  parseComputerFile,
  validateComputerParseOptions,
} from "@/lib/computer-import";
import { createDuplicateIndex } from "./duplicate-index";
import { computerHistorySummaryCsv } from "./summary-csv";

export type ComputerScope = { shopId: string; personId: string; actorPersonId: string };
export type ComputerFile = { name: string; bytes: Uint8Array };
export type ComputerImportOptions = ComputerParseOptions & { provider?: ComputerLogbookProvider };
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

function importOptions(raw: unknown): ComputerImportOptions {
  if (raw === undefined) return {};
  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Object.keys(raw).some((key) => key !== "provider" && key !== "csvMapping")
  )
    throw new Error("invalid_options");
  const value = raw as Record<string, unknown>;
  const provider = value.provider;
  if (Object.hasOwn(value, "provider") && !isComputerLogbookProvider(provider))
    throw new Error("invalid_options");
  return {
    ...(isComputerLogbookProvider(provider) ? { provider } : {}),
    ...validateComputerParseOptions(
      Object.hasOwn(value, "csvMapping") ? { csvMapping: value.csvMapping } : {},
    ),
  };
}

/** Transport and staff-chosen mapping/origin are provenance, not new dive identity. */
function fingerprint(record: ParsedComputerDive, fileHash: string, recordIndex: number) {
  const {
    importSource: _origin,
    csvMapping: _mapping,
    archiveEntry: _entry,
    archiveIgnoredEntries: _ignored,
    archiveEntryHash: _entryHash,
    archiveEntryRecordIndex: _entryIndex,
    ...identity
  } = record;
  if (record.localDate && !record.sourceId && !record.localStart && !record.startInstant) {
    return digest(
      JSON.stringify({
        record: identity,
        fileHash: record.archiveEntryHash ?? fileHash,
        recordIndex: record.archiveEntryRecordIndex ?? recordIndex,
      }),
    );
  }
  // Preserve the prior canonical representation for already-imported recordings.
  return digest(JSON.stringify(identity));
}

function parseFiles(files: ComputerFile[], options: ComputerImportOptions) {
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
      const records = parseComputerFile(
        file.bytes,
        options.csvMapping ? { csvMapping: options.csvMapping } : undefined,
      );
      const fileHash = digest(file.bytes);
      records.forEach((parsedRecord, index) => {
        const record: ParsedComputerDive = options.provider
          ? { ...parsedRecord, importSource: { provider: options.provider, beta: true } }
          : parsedRecord;
        dives.push({
          key: `${fileHash}:${fileIndex}:${index}`,
          fingerprint: fingerprint(record, fileHash, index),
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
  if (dives.reduce((sum, dive) => sum + dive.record.samples.length, 0) > 100_000)
    throw new Error("too_many_samples");
  return { files: results, dives };
}

export async function previewComputerFiles(
  db: AppDb,
  scope: ComputerScope,
  files: ComputerFile[],
  options?: ComputerImportOptions,
) {
  const person = await authorize(db, scope);
  const parsed = parseFiles(files, importOptions(options));
  const existing = await db
    .select({ fingerprint: computerDives.fingerprint, record: computerDives.record })
    .from(computerDives)
    .where(scopeWhere(scope));
  const seen = new Set(existing.map((row) => row.fingerprint));
  const prior = createDuplicateIndex();
  for (const row of existing) prior.add(row.record);
  const dives: PreviewDive[] = parsed.dives.map((dive) => {
    const duplicate = seen.has(dive.fingerprint)
      ? "exact"
      : prior.matches(dive.record)
        ? "possible"
        : null;
    seen.add(dive.fingerprint);
    prior.add(dive.record);
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
  options?: ComputerImportOptions;
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
  const options = importOptions(input.options);
  const parsed = parseFiles(input.files, options);
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
      if (record.localStart === null) throw new Error("invalid_timezone");
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
  const selectionHash = digest(
    JSON.stringify(Object.keys(options).length ? { selected, options } : selected),
  );
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

/** How many live dives this diver's computers have given the shop, for the file's row. */
export async function countComputerDives(db: AppDb, scope: ComputerScope) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(computerDives)
    .where(and(scopeWhere(scope), sql`${computerDives.deletedAt} is null`));
  return row?.count ?? 0;
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
      sql`coalesce(${computerDives.record}->>'localStart', ${computerDives.record}->>'localDate', ${computerDives.record}->>'startInstant')`,
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

/** Summary export avoids loading profiles and retains the full export's live authorization. */
export async function exportComputerDiveSummaryCsv(db: AppDb, scope: ComputerScope) {
  return db.transaction(async (tx) => {
    await authorize(tx, scope, true);
    const roles = await readActiveStaffRoles(tx, scope.shopId, scope.actorPersonId);
    if (!canExportShopData(roles ?? undefined)) throw new Error("not_authorized");
    const rows = await tx
      .select({
        id: computerDives.id,
        record: computerDives.record,
        annotation: computerDives.annotation,
        deletedAt: computerDives.deletedAt,
      })
      .from(computerDives)
      .where(scopeWhere(scope))
      .orderBy(asc(computerDives.id));
    return computerHistorySummaryCsv(
      rows.map((row) => ({
        ...row,
        record: row.record as unknown as Omit<ParsedComputerDive, "samples">,
      })),
    );
  });
}

/** What a diver's recap shows of one dive their own computer logged. */
export type RecapComputerDive = {
  id: string;
  device: string | null;
  /** Original wall time; no timezone is inferred when the recording has no instant. */
  localStart: string | null;
  localDate: string;
  startInstant: string | null;
  durationSeconds: number | null;
  maxDepthMeters: number | null;
  samples: Array<{ seconds: number; depthMeters: number; temperatureC?: number }>;
};

/** A day's recap lists at most this many recordings; a day past it is a computer dump, not a dive. */
const RECAP_COMPUTER_DIVES_LIMIT = 6;

export type RecapComputerDives = {
  dives: RecapComputerDive[];
};

/**
 * Personal recordings matching a calendar date, never recordings linked to a departure.
 * The bearer link resolves the shop and person; no other person's history is read. Known instants
 * use the shop's date. Unknown zones retain the file's wall date without pretending it is an instant.
 * Nothing here feeds the printed logbook, readiness, recency or the manifest.
 */
export async function recapComputerDives(
  db: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    date: string;
    timeZone: string;
  },
): Promise<RecapComputerDives> {
  const dives = await datedComputerDives(db, input);
  return { dives: dives.slice(0, RECAP_COMPUTER_DIVES_LIMIT) };
}

/** The person's live recordings for one date, in start order. A date match conveys no trip link. */
async function datedComputerDives(
  db: DbExecutor,
  input: { shopId: string; personId: string; date: string; timeZone: string },
): Promise<RecapComputerDive[]> {
  const rows = await db
    .select({ dive: computerDives, samples: computerDiveProfiles.samples })
    .from(computerDives)
    .innerJoin(
      people,
      and(
        eq(people.id, computerDives.personId),
        eq(people.shopId, input.shopId),
        sql`${people.deletedAt} is null`,
        sql`${people.anonymizedAt} is null`,
      ),
    )
    .leftJoin(
      computerDiveProfiles,
      and(
        eq(computerDiveProfiles.diveId, computerDives.id),
        eq(computerDiveProfiles.shopId, input.shopId),
        eq(computerDiveProfiles.personId, input.personId),
      ),
    )
    .where(
      and(
        eq(computerDives.shopId, input.shopId),
        eq(computerDives.personId, input.personId),
        sql`${computerDives.deletedAt} is null`,
      ),
    );
  const found: Array<{ sort: string; dive: RecapComputerDive }> = [];
  for (const { dive, samples } of rows) {
    const record = dive.record as unknown as Omit<ParsedComputerDive, "samples">;
    const date = record.startInstant
      ? calendarDateInTimezone(new Date(record.startInstant), input.timeZone)
      : (record.localDate ?? record.localStart?.slice(0, 10) ?? null);
    if (date !== input.date) continue;
    found.push({
      sort: record.startInstant ?? record.localStart ?? dive.fingerprint,
      dive: {
        id: dive.id,
        device: record.device,
        localStart: record.localStart,
        localDate: record.localDate ?? record.localStart?.slice(0, 10) ?? date,
        startInstant: record.startInstant,
        durationSeconds: record.durationSeconds,
        maxDepthMeters: record.maxDepthMeters,
        samples: samples ?? [],
      },
    });
  }
  return found.sort((a, b) => a.sort.localeCompare(b.sort)).map(({ dive }) => dive);
}
