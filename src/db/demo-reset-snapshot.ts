import { getTableName, type SQL, sql } from "drizzle-orm";
import { nowMs } from "@/lib/clock";
import { log } from "@/lib/log";
import type { AppDb, DbExecutor } from "./client";
import { clearDemoSchedule, resetDemoSchedule } from "./seed";

/**
 * The e2e fleet's demo reset, replayed from a copy instead of re-seeded
 * (ADR 20261024-e2e-reset-replays-a-snapshot).
 *
 * `resetDemoSchedule` is two halves: {@link clearDemoSchedule} deletes every
 * reset-owned row, and the re-seed writes about 4,400 of them back through
 * hundreds of statements. The second half is the same every time on a server
 * whose clock is frozen, so the first reset on a server runs it for real,
 * copies what it wrote into the `e2e_shadow` schema, and every later reset runs
 * the clear half and then one `INSERT … SELECT` per table from that copy.
 *
 * **Nothing here names a table.** What a reset owns is found by difference:
 * the capture copies every table, runs the clear half, and the rows that went
 * are the shadow. A table added to the clear half is in the shadow the next
 * time a server starts, and a table the clear half forgets is the same leak it
 * always was (`src/db/delete-path-coverage.test.ts`). Kept rows the re-seed
 * *changes* (a column it writes on the shop row, say) are found the same way,
 * column by column, and written back with an `UPDATE` of just those columns,
 * so everything else on a kept row keeps whatever a test left there, exactly as
 * a re-seed does (`RESET_KEEPS`).
 *
 * **The capture proves itself before it is trusted.** It runs in one
 * transaction: copy, clear, diff, replay, then compare every table with the
 * copy row for row. Any difference throws, the transaction rolls the shop back
 * to the state the real reset left, and the server keeps resetting the slow
 * way, saying so in its log.
 *
 * **A replay that fails falls back the same way.** It also runs in one
 * transaction, so a foreign key the shadow can no longer satisfy (a kept staff
 * row re-created under a new id, say) rolls it back whole; the reset then runs
 * for real and captures again.
 *
 * E2e only. The route that calls this sits behind `e2eTestRouteAuthorized`,
 * which refuses whenever a `DATABASE_URL` is configured, and the in-app "reset
 * demo shop" action calls `resetDemoSchedule` directly.
 */

const SHADOW_SCHEMA = "e2e_shadow";

/**
 * How a reset was served, and the tables a replay deleted seeded rows from and
 * wrote them back to — the ones with a round of dead tuples each time. Null
 * when it was not a replay.
 */
export type DemoReset = { mode: DemoResetMode; wrote: string[] | null };

/** How a reset was served. */
export type DemoResetMode =
  /** Replayed from the shadow. */
  | "snapshot"
  /** Re-seeded for real, then the shadow captured from the result. */
  | "captured"
  /** Re-seeded for real; no usable shadow (the log line says why). */
  | "reseeded";

type TablePlan = { table: string; shadow: string; sql: string; rows: number };

/** A foreign key, read off the catalog. */
type ForeignKey = {
  name: string;
  child: string;
  parent: string;
  /** `pg_constraint.confdeltype`: a no action, r restrict, c cascade, n set null. */
  onDelete: string;
  childColumns: string[];
  parentColumns: string[];
};

/** What a capture found: the statements a replay runs after the clear half. */
export type DemoResetPlan = {
  shopId: string;
  clockMs: number;
  foreignKeys: ForeignKey[];
  /** Kept rows the re-seed changes, column by column. */
  updates: TablePlan[];
  /** Reset-owned rows, parents first. */
  inserts: TablePlan[];
  /**
   * The function a replay calls: every insert above, then a refusal when a kept
   * row the shadow names is gone (a stable staffer re-created under a new id).
   */
  replay: string;
  /** The settle functions made so far, by the set of tables the clear deleted from. */
  settles: Map<string, string>;
};

type Capture = { plan: DemoResetPlan } | { refused: string };

// One capture per database. Keyed on the db object because the shadow lives in
// that database; a new server is a new db and captures again.
const captures = new WeakMap<object, Capture>();

/**
 * Reset the canonical demo shop to its seeded schedule, from the shadow when
 * there is a usable one. Always leaves the shop exactly as `resetDemoSchedule`
 * with `{ history: true }` would, modulo the ids of the rows it writes.
 */
export async function resetDemoFromSnapshot(db: AppDb, shopId: string): Promise<DemoReset> {
  const capture = captures.get(db);
  if (capture && "plan" in capture && planFits(capture.plan, shopId)) {
    try {
      await db.transaction((tx) => clearAndReplay(tx, shopId, capture.plan));
      const { inserts, updates } = capture.plan;
      return {
        mode: "snapshot",
        wrote: [...new Set([...inserts, ...updates].map((step) => step.table))].sort(),
      };
    } catch (error) {
      // Rolled back whole; fall through to a real reset and a fresh capture.
      log("e2e_reset.snapshot_replay_failed", "warn", { message: errorMessage(error) });
      captures.delete(db);
    }
  }
  await resetDemoSchedule(db, shopId, { history: true });
  if (capture && "refused" in capture) return { mode: "reseeded", wrote: null };
  try {
    const plan = await capturePlan(db, shopId);
    captures.set(db, { plan });
    return { mode: "captured", wrote: null };
  } catch (error) {
    const reason = errorMessage(error);
    captures.set(db, { refused: reason });
    log("e2e_reset.snapshot_refused", "warn", { message: reason });
    return { mode: "reseeded", wrote: null };
  }
}

/** The plan captured for this database, for the coverage tests. */
export function capturedDemoResetPlan(db: AppDb): DemoResetPlan | null {
  const capture = captures.get(db);
  return capture && "plan" in capture ? capture.plan : null;
}

/** A shadow is only the right answer for the shop and the instant it was taken at. */
function planFits(plan: DemoResetPlan, shopId: string): boolean {
  return plan.shopId === shopId && plan.clockMs === nowMs();
}

/**
 * The clear half and the replay, inside the caller's transaction.
 *
 * **Both run with foreign-key triggers off**
 * (`session_replication_role = replica`, transaction-local), and the checks the
 * triggers would have made are made by set instead. That is most of the saving:
 * Postgres checks every deleted row against every table that references it,
 * and every inserted row against every table it references, one row at a time,
 * mostly through columns with no index. Measured on 2026-10-24 on a loaded box:
 * the clear half took 1.2s with its triggers and 0.12s without, and the inserts
 * 0.4s with and 0.14s without. What stands in for the triggers:
 *
 * - after the clear, from the tables it deleted from outward, an `ON DELETE
 *   CASCADE` or `SET NULL` key is applied as one statement over every row it
 *   would have reached, and any other key left with a row pointing at nothing
 *   **refuses the replay**, as its trigger would have with a 23503 — so a
 *   table missing from the clear half's ordering still fails loudly (the reset
 *   falls back to a real one, which raises the 23503 itself);
 * - after the inserts, every kept row the shadow names is checked to still be
 *   there. The shadow's rows naming each other were checked when it was taken.
 *
 * Unique, check and exclusion constraints are not triggers and stay on.
 */
async function clearAndReplay(tx: DbExecutor, shopId: string, plan: DemoResetPlan): Promise<void> {
  await clearWithoutTriggers(tx, shopId, plan.foreignKeys, plan.settles);
  await replayRows(tx, plan);
}

/**
 * The settle and the replay are PL/pgSQL functions rather than statements sent
 * one at a time: one round trip each, and the server keeps their plans between
 * calls, which took the settle from ~65ms a reset to a few. A settle depends on
 * which tables the clear deleted from, so there is one per set seen.
 */
async function clearWithoutTriggers(
  tx: DbExecutor,
  shopId: string,
  keys: ForeignKey[],
  settles: Map<string, string>,
): Promise<void> {
  await tx.execute(sql.raw("set local session_replication_role = replica"));
  const deletedFrom = new Set<string>();
  await clearDemoSchedule(recordingDeletes(tx, deletedFrom), shopId);
  const signature = [...deletedFrom].sort().join(",");
  let settle = settles.get(signature);
  if (settle === undefined) {
    const body = settleBody(keys, deletedFrom);
    settle = `${SHADOW_SCHEMA}.settle_${settles.size}`;
    await tx.execute(
      sql.raw(
        `create function ${settle}() returns void language plpgsql as $settle$ declare n bigint; changed boolean; begin ${body} end $settle$`,
      ),
    );
    settles.set(signature, settle);
  }
  await tx.execute(sql.raw(`select ${settle}()`));
  await tx.execute(sql.raw("set local session_replication_role = origin"));
}

async function replayRows(tx: DbExecutor, plan: DemoResetPlan): Promise<void> {
  await tx.execute(sql.raw("set local session_replication_role = replica"));
  await tx.execute(sql.raw(`select ${plan.replay}()`));
  await tx.execute(sql.raw("set local session_replication_role = origin"));
  // Few rows, if any, and their triggers on: a kept row's column put back.
  for (const step of plan.updates) await tx.execute(sql.raw(step.sql));
}

/** `db`, noting the name of every table a `db.delete(table)` is called on. */
function recordingDeletes(db: DbExecutor, into: Set<string>): DbExecutor {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "delete") {
        return (table: Parameters<DbExecutor["delete"]>[0]) => {
          into.add(getTableName(table));
          return target.delete(table);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * PL/pgSQL doing what the delete triggers of the keys reachable from
 * `deletedFrom` would have done; see {@link clearAndReplay}.
 */
function settleBody(keys: ForeignKey[], deletedFrom: Set<string>): string {
  const reached = cascadeReach(keys, deletedFrom);
  const acting = keys.filter(
    (key) => (key.onDelete === "c" || key.onDelete === "n") && reached.has(key.parent),
  );
  const refusing = keys.filter(
    (key) => (key.onDelete === "a" || key.onDelete === "r") && reached.has(key.parent),
  );
  if (acting.length === 0 && refusing.length === 0) return "null;";

  // A cascade into a table runs before the keys out of it, so one pass reaches
  // the end of every chain; a cycle between tables repeats the pass instead.
  const { ordered, cyclic } = cascadesFirst(acting);
  const statements = ordered.map((key) => {
    const where = `${named(key)} and not exists (select 1 from ${pub(key.parent)} p where ${matching(key)})`;
    const statement =
      key.onDelete === "c"
        ? `delete from ${pub(key.child)} c where ${where}`
        : `update ${pub(key.child)} c set ${key.childColumns.map((column) => `${q(column)} = null`).join(", ")} where ${where}`;
    if (key.onDelete === "c" && (key.child === key.parent || cyclic)) {
      return `${statement}; get diagnostics n = row_count; if n > 0 then changed := true; end if;`;
    }
    return `${statement};`;
  });
  const settle =
    cyclic || ordered.some((key) => key.onDelete === "c" && key.child === key.parent)
      ? `loop changed := false; ${statements.join(" ")} exit when not changed; end loop;`
      : statements.join(" ");
  const refuse = refusing.map(
    (key) =>
      `if exists (select 1 ${orphans(key)}) then raise exception using errcode = '23503', message = ${literal(`the clear half left rows naming deleted parents: ${key.child} (${key.name})`)}; end if;`,
  );
  return `${settle} ${refuse.join(" ")}`;
}

/** Every table a cascade can reach from the tables the clear deleted from, and those. */
function cascadeReach(keys: ForeignKey[], deletedFrom: Set<string>): Set<string> {
  const reached = new Set(deletedFrom);
  for (let grew = true; grew; ) {
    grew = false;
    for (const key of keys) {
      if (key.onDelete === "c" && reached.has(key.parent) && !reached.has(key.child)) {
        reached.add(key.child);
        grew = true;
      }
    }
  }
  return reached;
}

function cascadesFirst(keys: ForeignKey[]): { ordered: ForeignKey[]; cyclic: boolean } {
  const pending = new Set(keys);
  const ordered: ForeignKey[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(
      (key) =>
        ![...pending].some(
          (other) =>
            other !== key &&
            other.onDelete === "c" &&
            other.child === key.parent &&
            other.child !== other.parent,
        ),
    );
    if (ready.length === 0) return { ordered: [...ordered, ...pending], cyclic: true };
    for (const key of ready) {
      ordered.push(key);
      pending.delete(key);
    }
  }
  return { ordered, cyclic: false };
}

/** The key's columns all set, which is when MATCH SIMPLE checks a row at all. */
function named(key: ForeignKey, alias = "c"): string {
  return key.childColumns.map((column) => `${alias}.${q(column)} is not null`).join(" and ");
}

function matching(key: ForeignKey, alias = "c"): string {
  return key.childColumns
    .map((column, i) => `p.${q(key.parentColumns[i] as string)} = ${alias}.${q(column)}`)
    .join(" and ");
}

/** Rows of the key's child naming a parent row that is not there, as a `from … where …` tail. */
function orphans(key: ForeignKey): string {
  return `from ${pub(key.child)} c where ${named(key)} and not exists (select 1 from ${pub(key.parent)} p where ${matching(key)})`;
}

type Table = {
  name: string;
  /** Columns a row can be written with: generated ones are left out. */
  columns: string[];
  primaryKey: string[];
  hasIdentity: boolean;
  /** Tables this one's foreign keys point at. */
  parents: string[];
};

/**
 * Take the shadow from the state a real reset just left, and prove a replay
 * reproduces it. Runs in one transaction, so a refusal leaves that state as it
 * was.
 */
async function capturePlan(db: AppDb, shopId: string): Promise<DemoResetPlan> {
  const clockMs = nowMs();
  return db.transaction(async (tx) => {
    const tables = await readTables(tx);
    await tx.execute(sql.raw(`drop schema if exists ${SHADOW_SCHEMA} cascade`));
    await tx.execute(sql.raw(`create schema ${SHADOW_SCHEMA}`));
    const seeded = new Map<string, string>();
    for (const [index, table] of tables.entries()) {
      const copy = `seeded_${index}`;
      seeded.set(table.name, copy);
      await tx.execute(
        sql.raw(`create temp table ${copy} on commit drop as select * from ${pub(table.name)}`),
      );
    }

    const foreignKeys = await readForeignKeys(tx);
    const settles = new Map<string, string>();
    await clearWithoutTriggers(tx, shopId, foreignKeys, settles);

    const updates: TablePlan[] = [];
    const inserts: TablePlan[] = [];
    for (const [index, table] of tables.entries()) {
      const copy = seeded.get(table.name) as string;
      if (table.primaryKey.length === 0) {
        if (await differs(tx, copy, pub(table.name))) {
          throw new Error(`${table.name} has no primary key and a reset changes it`);
        }
        continue;
      }
      const match = table.primaryKey.map((c) => `s.${q(c)} = t.${q(c)}`).join(" and ");
      const added = await count(
        tx,
        `select count(*) from ${pub(table.name)} t where not exists (select 1 from ${copy} s where ${match})`,
      );
      if (added > 0) {
        throw new Error(`the clear half inserted ${added} row(s) into ${table.name}`);
      }

      const gone = `${SHADOW_SCHEMA}.rows_${index}`;
      const goneRows = await count(
        tx,
        `select count(*) from ${copy} s where not exists (select 1 from ${pub(table.name)} t where ${match})`,
      );
      if (goneRows > 0) {
        await tx.execute(
          sql.raw(
            `create table ${gone} as select s.* from ${copy} s where not exists (select 1 from ${pub(table.name)} t where ${match})`,
          ),
        );
        const columns = table.columns.map(q).join(", ");
        const override = table.hasIdentity ? " overriding system value" : "";
        inserts.push({
          table: table.name,
          shadow: gone,
          rows: goneRows,
          sql: `insert into ${pub(table.name)} (${columns})${override} select ${columns} from ${gone}`,
        });
      }

      const changedRows = await count(
        tx,
        `select count(*) from ${copy} s join ${pub(table.name)} t on ${match} where s::text is distinct from t::text`,
      );
      if (changedRows === 0) continue;
      const changed: string[] = [];
      for (const column of table.columns) {
        if (table.primaryKey.includes(column)) continue;
        const moved = await count(
          tx,
          `select count(*) from ${copy} s join ${pub(table.name)} t on ${match} where s.${q(column)}::text is distinct from t.${q(column)}::text`,
        );
        if (moved > 0) changed.push(column);
      }
      const kept = `${SHADOW_SCHEMA}.kept_${index}`;
      const keys = table.primaryKey.map(q);
      const values = changed.map(q);
      await tx.execute(
        sql.raw(
          `create table ${kept} as select ${[...keys, ...values].map((c) => `s.${c}`).join(", ")} from ${copy} s join ${pub(table.name)} t on ${match} where (${values.map((c) => `s.${c}`).join(", ")},null)::text is distinct from (${values.map((c) => `t.${c}`).join(", ")},null)::text`,
        ),
      );
      updates.push({
        table: table.name,
        shadow: kept,
        rows: changedRows,
        sql: `update ${pub(table.name)} t set ${values.map((c) => `${c} = k.${c}`).join(", ")} from ${kept} k where ${keys.map((c) => `t.${c} = k.${c}`).join(" and ")}`,
      });
    }

    const ordered = parentsFirst(inserts, tables);
    const anchorChecks = await buildAnchors(tx, inserts, foreignKeys);
    const replay = `${SHADOW_SCHEMA}.replay`;
    await tx.execute(
      sql.raw(
        `create function ${replay}() returns void language plpgsql as $replay$ begin ${[...ordered.map((step) => `${step.sql};`), ...anchorChecks].join(" ")} end $replay$`,
      ),
    );
    const plan: DemoResetPlan = {
      shopId,
      clockMs,
      foreignKeys,
      updates,
      inserts: ordered,
      replay,
      settles,
    };
    await replayRows(tx, plan);

    // The shadow's rows naming each other are checked once, here, since a
    // replay writes them with the triggers off. Against the real reset's state
    // this cannot fail, which is the point: a failure is a bug in the capture.
    const inserted = new Set(inserts.map((step) => step.table));
    for (const key of foreignKeys) {
      if (!inserted.has(key.child)) continue;
      if ((await count(tx, `select count(*) ${orphans(key)}`)) > 0) {
        throw new Error(`a replay leaves ${key.child} naming missing rows (${key.name})`);
      }
    }

    // The proof: every table now holds exactly what the real reset left.
    for (const table of tables) {
      if (await differs(tx, seeded.get(table.name) as string, pub(table.name))) {
        throw new Error(`a replay does not reproduce ${table.name}`);
      }
    }
    return plan;
  });
}

/** True when two relations do not hold the same multiset of rows. */
async function differs(db: DbExecutor, left: string, right: string): Promise<boolean> {
  const extra = await count(
    db,
    `select count(*) from (select l::text from ${left} l except all select r::text from ${right} r) d`,
  );
  if (extra > 0) return true;
  const missing = await count(
    db,
    `select count(*) from (select r::text from ${right} r except all select l::text from ${left} l) d`,
  );
  return missing > 0;
}

/**
 * Order the inserts so every foreign key's target is written before the row
 * that names it. A cycle between two tables would need deferred constraints
 * the schema does not declare, so it refuses the capture rather than guess.
 */
function parentsFirst(steps: TablePlan[], tables: Table[]): TablePlan[] {
  const parents = new Map(tables.map((t) => [t.name, t.parents]));
  const pending = new Map(steps.map((step) => [step.table, step]));
  const ordered: TablePlan[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((step) =>
      (parents.get(step.table) ?? []).every(
        (parent) => parent === step.table || !pending.has(parent),
      ),
    );
    if (ready.length === 0) {
      throw new Error(`foreign-key cycle among ${[...pending.keys()].sort().join(", ")}`);
    }
    for (const step of ready) {
      ordered.push(step);
      pending.delete(step.table);
    }
  }
  return ordered;
}

async function readTables(db: DbExecutor): Promise<Table[]> {
  const names = await rows<{ name: string }>(
    db,
    sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
  );
  const columns = await rows<{ table: string; column: string; identity: string }>(
    db,
    sql`select c.relname as table, a.attname as column, a.attidentity as identity
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0
          and not a.attisdropped and a.attgenerated = ''
        order by c.relname, a.attnum`,
  );
  const keys = await rows<{ table: string; column: string }>(
    db,
    sql`select c.relname as table, a.attname as column
        from pg_index i join pg_class c on c.oid = i.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
        where n.nspname = 'public' and i.indisprimary
        order by c.relname, a.attnum`,
  );
  const references = await rows<{ child: string; parent: string }>(
    db,
    sql`select c.relname as child, p.relname as parent
        from pg_constraint k join pg_class c on c.oid = k.conrelid
        join pg_class p on p.oid = k.confrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and k.contype = 'f'`,
  );
  return names.map(({ name }) => ({
    name,
    columns: columns.filter((c) => c.table === name).map((c) => c.column),
    hasIdentity: columns.some((c) => c.table === name && c.identity !== ""),
    primaryKey: keys.filter((k) => k.table === name).map((k) => k.column),
    parents: [...new Set(references.filter((r) => r.child === name).map((r) => r.parent))],
  }));
}

/**
 * Collect every kept row the shadow names — a key into a table the shadow does
 * not hold that row of — one table per parent key, and return the statements a
 * replay runs to check they are all still there.
 */
async function buildAnchors(
  tx: DbExecutor,
  inserts: TablePlan[],
  keys: ForeignKey[],
): Promise<string[]> {
  const shadowOf = new Map(inserts.map((step) => [step.table, step.shadow]));
  const anchors = new Map<string, { table: string; key: ForeignKey }>();
  for (const key of keys) {
    const shadow = shadowOf.get(key.child);
    if (!shadow) continue;
    const group = `${key.parent}(${key.parentColumns.join(",")})`;
    const anchor = anchors.get(group) ?? {
      table: `${SHADOW_SCHEMA}.anchor_${anchors.size}`,
      key,
    };
    const columns = key.childColumns
      .map((column, i) => `c.${q(column)} as ${q(key.parentColumns[i] as string)}`)
      .join(", ");
    const parentShadow = shadowOf.get(key.parent);
    const internal = parentShadow
      ? ` and not exists (select 1 from ${parentShadow} p where ${matching(key)})`
      : "";
    const select = `select distinct ${columns} from ${shadow} c where ${named(key)}${internal}`;
    await tx.execute(
      sql.raw(
        anchors.has(group)
          ? `insert into ${anchor.table} ${select}`
          : `create table ${anchor.table} as ${select}`,
      ),
    );
    anchors.set(group, anchor);
  }
  const checks: string[] = [];
  for (const { table, key } of anchors.values()) {
    if ((await count(tx, `select count(*) from ${table}`)) === 0) continue;
    const match = key.parentColumns
      .map((column) => `p.${q(column)} = a.${q(column)}`)
      .join(" and ");
    checks.push(
      `if exists (select 1 from ${table} a where not exists (select 1 from ${pub(key.parent)} p where ${match})) then raise exception using errcode = '23503', message = ${literal(`the shadow names a ${key.parent} row that is gone`)}; end if;`,
    );
  }
  return checks;
}

async function readForeignKeys(db: DbExecutor): Promise<ForeignKey[]> {
  const keys = await rows<{
    name: string;
    child: string;
    parent: string;
    on_delete: string;
    child_columns: string[];
    parent_columns: string[];
    partial_set: boolean;
  }>(
    db,
    sql`select k.conname as name, c.relname as child, p.relname as parent,
          k.confdeltype as on_delete,
          array(select a.attname from unnest(k.conkey) with ordinality u(n, i)
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n order by u.i)::text[]
            as child_columns,
          array(select a.attname from unnest(k.confkey) with ordinality u(n, i)
                join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.n order by u.i)::text[]
            as parent_columns,
          coalesce(cardinality(k.confdelsetcols), 0) > 0 as partial_set
        from pg_constraint k join pg_class c on c.oid = k.conrelid
        join pg_class p on p.oid = k.confrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and k.contype = 'f'
        order by k.conname`,
  );
  return keys.map((key) => {
    // Neither is in the schema; replaying one would need its own statement.
    if (key.on_delete === "d" || key.partial_set) {
      throw new Error(
        `${key.name}: ON DELETE SET DEFAULT and column-list SET NULL are not replayed`,
      );
    }
    return {
      name: key.name,
      child: key.child,
      parent: key.parent,
      onDelete: key.on_delete,
      childColumns: key.child_columns,
      parentColumns: key.parent_columns,
    };
  });
}

async function rows<T>(db: DbExecutor, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

async function count(db: DbExecutor, query: string): Promise<number> {
  const [row] = await rows<{ count: string | number }>(db, sql.raw(query));
  return Number(row?.count ?? 0);
}

/** A quoted identifier. Every name here comes from the catalog, never from a request. */
function q(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function pub(table: string): string {
  return `public.${q(table)}`;
}

/** A SQL string literal. */
function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
