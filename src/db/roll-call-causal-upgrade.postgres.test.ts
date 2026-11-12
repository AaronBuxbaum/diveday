import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { applyMigrations, describePostgres, postgresTestDb } from "@/test/postgres";
import { materializeMigrations } from "../../scripts/previous-release-migrations.mjs";
import type { AppDb, DbExecutor } from "./client";
import { recordCrewRollCall, recordRollCall } from "./manifests";
import { manifestCausalContexts } from "./roll-call-causal-store";
import { rollCallEvents } from "./schema";

const PRE_CAUSAL = "f25e9b2bbd54643cba05783e3ab119151cf3f54f";
const WITHDRAWAL = "20261112114508_retain-unknown-roll-call-withdrawals";
const INITIALIZER = "drizzle/20261112045647_initialize-retained-roll-call-evidence/migration.sql";

async function oldScope(db: AppDb, multiDay = false) {
  const shopId = crypto.randomUUID();
  const tripId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  await db.execute(
    sql`insert into shops (id,name,slug,timezone) values (${shopId},'Upgrade fixture',${shopId},'UTC')`,
  );
  // These rows deliberately use the serving pre-causal SQL shape.
  await db.execute(
    sql`insert into people (id,shop_id,full_name) values (${personId},${shopId},'Upgrade crew')`,
  );
  await db.execute(
    sql`insert into trips (id,shop_id,title,starts_at,ends_at,capacity) values (${tripId},${shopId},'Upgrade boat','2026-07-20T13:00Z','2026-07-22T17:00Z',8)`,
  );
  await db.execute(
    sql`insert into bookings (id,shop_id,trip_id,person_id,booked_as) values (${bookingId},${shopId},${tripId},${personId},'diver')`,
  );
  if (multiDay)
    await db.execute(
      sql`insert into trip_schedule_days (trip_id,day_number,starts_at,ends_at) values (${tripId},1,'2026-07-20T13:00Z','2026-07-20T17:00Z'),(${tripId},2,'2026-07-22T13:00Z','2026-07-22T17:00Z')`,
    );
  return { shopId, tripId, personId, bookingId };
}

async function oldMark(
  db: AppDb,
  scope: Awaited<ReturnType<typeof oldScope>>,
  status: "boarded" | "not_boarded" | "cleared",
  options: {
    crew?: boolean;
    checkpoint?: string;
    retracts?: string;
    at?: string;
    clientEventId?: string;
  } = {},
) {
  const id = crypto.randomUUID();
  await db.execute(sql`insert into roll_call_events (id,shop_id,trip_id,subject_kind,booking_id,crew_person_id,recorded_by_person_id,status,checkpoint,retracts_event_id,occurred_at,note,source,client_event_id) values (
    ${id},${scope.shopId},${scope.tripId},${options.crew ? "crew" : "seat"}::roll_call_subject_kind,
    ${options.crew ? null : scope.bookingId},${options.crew ? scope.personId : null},${scope.personId},${status}::roll_call_status,
    ${options.checkpoint ?? "after_dive_1"},${options.retracts ?? null},${options.at ?? "2026-07-20T14:00Z"}::timestamptz,'Original crew evidence',${options.clientEventId ? "offline" : "live"},${options.clientEventId ?? null})`);
  return id;
}

async function initialize(db: DbExecutor) {
  for (const statement of readFileSync(INITIALIZER, "utf8").split("--> statement-breakpoint")) {
    await db.execute(sql.raw(statement));
  }
}

describePostgres("retained pre-causal roll-call upgrade", () => {
  it("preserves opposing evidence, exact undo targets and unknown days transactionally on Postgres", async () => {
    const pg = await postgresTestDb({ migrations: false });
    const previousDir = mkdtempSync(path.join(tmpdir(), "diveday-causal-upgrade-"));
    onTestFinished(() => rmSync(previousDir, { recursive: true, force: true }));
    const previous = materializeMigrations(PRE_CAUSAL, previousDir);
    if (!previous.ok) throw new Error(previous.reason);
    await applyMigrations(pg.db, previousDir);
    const scope = await oldScope(pg.db);
    const other = await oldScope(pg.db);
    const multi = await oldScope(pg.db, true);
    const retained = await oldScope(pg.db);
    const withdrawalCases: { id: string; expected: string; day: number }[] = [];
    for (const crew of [false, true]) {
      for (const multiDay of [false, true]) {
        const uncertain = await oldScope(pg.db, multiDay);
        await oldMark(pg.db, uncertain, "not_boarded", { crew, checkpoint: "departure" });
        const id = await oldMark(pg.db, uncertain, "cleared", { crew, checkpoint: "departure" });
        withdrawalCases.push({ id, expected: "cleared", day: multiDay ? -1 : 0 });
      }
      const missing = await oldScope(pg.db);
      await oldMark(pg.db, missing, "not_boarded", { crew });
      const missingUndo = await oldMark(pg.db, missing, "cleared", { crew });
      withdrawalCases.push({ id: missingUndo, expected: "not_boarded", day: 0 });
      const exact = await oldScope(pg.db);
      const kept = await oldMark(pg.db, exact, "not_boarded", { crew, checkpoint: "departure" });
      await oldMark(pg.db, exact, "not_boarded", { crew, checkpoint: "departure" });
      const exactUndo = await oldMark(pg.db, exact, "cleared", {
        crew,
        checkpoint: "departure",
        retracts: kept,
      });
      withdrawalCases.push({ id: exactUndo, expected: "not_boarded", day: 0 });
    }

    const retainedRetries: {
      crew: boolean;
      targetClientId: string;
      undoClientId: string;
      target: string;
      undo: string;
    }[] = [];
    for (const crew of [false, true]) {
      const targetClientId = crypto.randomUUID(),
        undoClientId = crypto.randomUUID();
      const target = await oldMark(pg.db, retained, "not_boarded", {
        crew,
        clientEventId: targetClientId,
      });
      const undo = await oldMark(pg.db, retained, "cleared", {
        crew,
        clientEventId: undoClientId,
        retracts: target,
      });
      retainedRetries.push({ crew, targetClientId, undoClientId, target, undo });
    }
    await oldMark(pg.db, scope, "not_boarded");
    const aboard = await oldMark(pg.db, scope, "boarded", { at: "2026-07-20T14:10Z" });
    await oldMark(pg.db, scope, "not_boarded", { crew: true });
    const crewAboard = await oldMark(pg.db, scope, "boarded", { crew: true });
    const compatible = await oldMark(pg.db, scope, "boarded", { checkpoint: "after_dive_2" });
    await oldMark(pg.db, other, "boarded");
    const undone = await oldMark(pg.db, other, "not_boarded", { checkpoint: "after_dive_2" });
    const undo = await oldMark(pg.db, other, "cleared", {
      checkpoint: "after_dive_2",
      retracts: undone,
    });
    const unknown = await oldMark(pg.db, multi, "not_boarded", { at: "2027-07-20T14:00Z" });
    // Rehearse the expanded nullable stage before the required/read-fence migration.
    const expandedDir = mkdtempSync(path.join(tmpdir(), "diveday-causal-expanded-"));
    onTestFinished(() => rmSync(expandedDir, { recursive: true, force: true }));
    const expanded = materializeMigrations(PRE_CAUSAL, expandedDir);
    if (!expanded.ok) throw new Error(expanded.reason);
    cpSync(
      "drizzle/20261112045631_roll-call-causal-evidence",
      path.join(expandedDir, "20261112045631_roll-call-causal-evidence"),
      { recursive: true },
    );
    await applyMigrations(pg.db, expandedDir);
    await expect(
      pg.db.transaction(async (tx) => {
        await initialize(tx);
        throw new Error("rollback upgrade");
      }),
    ).rejects.toThrow("rollback upgrade");
    const rollback = await pg.db.execute(
      sql`select statement_status,causal_frontier from roll_call_events where id = ${aboard}`,
    );
    const rollbackRows = (
      Array.isArray(rollback) ? rollback : (rollback as unknown as { rows: unknown[] }).rows
    ) as { statement_status: string | null; causal_frontier: unknown }[];
    expect(rollbackRows[0]).toEqual({ statement_status: null, causal_frontier: null });
    await pg.db.transaction(initialize);
    const firstInitialization = await pg.db.execute(
      sql`select id,status,statement_status,causal_frontier,evidence_conflict from roll_call_events order by seq`,
    );
    await pg.db.transaction(initialize);
    const repeatedInitialization = await pg.db.execute(
      sql`select id,status,statement_status,causal_frontier,evidence_conflict from roll_call_events order by seq`,
    );
    expect(JSON.stringify(repeatedInitialization)).toBe(JSON.stringify(firstInitialization));
    const beforeWithdrawal = mkdtempSync(path.join(tmpdir(), "diveday-before-withdrawal-"));
    onTestFinished(() => rmSync(beforeWithdrawal, { recursive: true, force: true }));
    for (const name of readdirSync("drizzle")) {
      if (name !== WITHDRAWAL)
        cpSync(path.join("drizzle", name), path.join(beforeWithdrawal, name), { recursive: true });
    }
    await applyMigrations(pg.db, beforeWithdrawal);
    const retainedRows = () => pg.db.select().from(rollCallEvents).orderBy(rollCallEvents.seq);
    const before = await retainedRows();
    const repair = async (tx: DbExecutor) => {
      for (const statement of readFileSync(`drizzle/${WITHDRAWAL}/migration.sql`, "utf8").split(
        "--> statement-breakpoint",
      ))
        await tx.execute(sql.raw(statement));
    };
    await expect(
      pg.db.transaction(async (tx) => {
        await repair(tx);
        throw new Error("rollback withdrawal");
      }),
    ).rejects.toThrow("rollback withdrawal");
    expect(await retainedRows()).toEqual(before);
    await applyMigrations(pg.db, "drizzle");
    const repaired = await retainedRows();
    await pg.db.transaction(repair);
    expect(await retainedRows()).toEqual(repaired);
    for (const control of withdrawalCases) {
      const original = before.find((row) => row.id === control.id);
      const after = repaired.find((row) => row.id === control.id);
      expect(after).toEqual({ ...original, status: control.expected });
      expect(after?.meetingDay).toBe(control.day);
    }

    // An updated app retries the real client-ID target from the old queue.
    // Migration must not manufacture a captured day or overwrite opaque intent.
    await pg.db.execute(
      sql`insert into person_roles (person_id,role) values (${retained.personId},'owner')`,
    );
    await pg.db.execute(
      sql`insert into user_accounts (person_id,email) values (${retained.personId},'retained-upgrade@example.invalid')`,
    );
    for (const retry of retainedRetries) {
      const [beforeRetry] = await pg.db
        .select()
        .from(rollCallEvents)
        .where(sql`${rollCallEvents.id} = ${retry.undo}`);
      expect(beforeRetry).toMatchObject({ captureContext: null, retractsEventId: retry.target });
      const input = {
        shopId: retained.shopId,
        tripId: retained.tripId,
        recordedByPersonId: retained.personId,
        checkpoint: "after_dive_1" as const,
        status: "cleared" as const,
        source: "offline" as const,
        clientEventId: retry.undoClientId,
        retractsClientEventId: retry.targetClientId,
        occurredAt: new Date("2026-07-20T14:00Z"),
        offlineSnapshotSavedAt: new Date("2026-07-20T13:00Z"),
      };
      const write = (value: typeof input) =>
        retry.crew
          ? recordCrewRollCall(pg.db, { ...value, personId: retained.personId })
          : recordRollCall(pg.db, { ...value, bookingId: retained.bookingId });
      expect(await write(input)).toMatchObject({ ok: true, duplicate: true, eventId: retry.undo });
      expect(await write({ ...input, retractsClientEventId: crypto.randomUUID() })).toMatchObject({
        ok: false,
        reason: "client_event_conflict",
      });
      const [afterRetry] = await pg.db
        .select()
        .from(rollCallEvents)
        .where(sql`${rollCallEvents.id} = ${retry.undo}`);
      expect(afterRetry).toEqual(beforeRetry);
    }
    const rows = await pg.db.select().from(rollCallEvents);
    expect(rows.find((row) => row.id === aboard)).toMatchObject({
      status: "not_boarded",
      statementStatus: "boarded",
      evidenceConflict: true,
      evidenceOrderingUnknown: true,
      note: "Original crew evidence",
    });
    expect(rows.find((row) => row.id === crewAboard)).toMatchObject({
      status: "not_boarded",
      statementStatus: "boarded",
      evidenceConflict: true,
    });
    expect(rows.find((row) => row.id === compatible)).toMatchObject({
      status: "boarded",
      evidenceConflict: false,
    });
    expect(rows.find((row) => row.id === undo)).toMatchObject({
      status: "cleared",
      retractsEventId: undone,
      evidenceConflict: false,
    });
    expect(rows.find((row) => row.id === unknown)).toMatchObject({
      status: "not_boarded",
      meetingDay: -1,
    });
    expect(
      (await manifestCausalContexts(pg.db, multi.shopId, multi.tripId)).contexts.get(
        `seat:${multi.bookingId}/after_dive_1`,
      ),
    ).toMatchObject({ unknownMeetingDay: true });
    const beforeRerun = JSON.stringify(rows);
    await applyMigrations(pg.db, "drizzle");
    expect(JSON.stringify(await pg.db.select().from(rollCallEvents))).toBe(beforeRerun);
    // Old timestamp readers and old SQL writers fail visibly after the fence.
    await expect(
      pg.db.execute(sql`select status from roll_call_events where shop_id = ${scope.shopId}`),
    ).rejects.toMatchObject({ cause: { code: "42703" } });
    await expect(
      oldMark(pg.db, other, "not_boarded", { checkpoint: "after_dive_3" }),
    ).rejects.toMatchObject({ cause: { code: "42703" } });
    // No defaults may make an incomplete new writer appear projected.
    await expect(
      pg.db.execute(
        sql`insert into roll_call_events (shop_id,trip_id,booking_id,recorded_by_person_id,effective_status,causal_frontier,occurred_at) values (${scope.shopId},${scope.tripId},${scope.bookingId},${scope.personId},'not_boarded','[]'::jsonb,'2026-07-20T14:00Z')`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23502", column: "statement_status" } });
    await expect(
      pg.db.execute(
        sql`insert into roll_call_events (shop_id,trip_id,booking_id,recorded_by_person_id,effective_status,statement_status,occurred_at) values (${scope.shopId},${scope.tripId},${scope.bookingId},${scope.personId},'not_boarded','not_boarded','2026-07-20T14:00Z')`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23502", column: "causal_frontier" } });
    expect(await pg.db.select({ id: rollCallEvents.id }).from(rollCallEvents)).toHaveLength(
      rows.length,
    );
  });
});
