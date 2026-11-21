import { sql } from "drizzle-orm";
import {
  count,
  type ForeignKey,
  literal,
  pub,
  q,
  readForeignKeys,
  readTables,
  rows,
  type Table,
} from "../../db/catalog";
import type { AppDb, DbExecutor } from "../../db/client";
import { createDemoShop, DEMO_SHOP_TIMEZONE, enforceMintedDemoCap } from "../../db/seed";
import { nowDate } from "../../lib/clock";
import { generateDemoShopIdentity } from "../../lib/demo-identity";
import { log } from "../../lib/log";
import { shopDayOf } from "../../lib/shop-day";

/**
 * A visitor's demo shop, minted by copying a shop this process already built
 * instead of building another (issue #4763, ADR 20261120-demo-mint-replays-a-template).
 *
 * `createDemoShop` is ~1,400 statements (the cast, a quarter of history, the
 * day's boats), 2.7 to 3.2 s on an idle box and twice that under load, and
 * against a hosted database each statement is a round trip. The shop it writes
 * is the same shop every time but for its name, so the first mint in a process
 * builds one for real, reads back everything the new shop owns, and every later
 * mint on the same shop-local day writes that copy back under new ids: one
 * `INSERT … SELECT` per table, ~100 statements.
 *
 * **Nothing here names a table.** What a shop owns is the closure of the rows
 * naming it through foreign keys, found in one PL/pgSQL block from the catalog;
 * a table added to the schema is in the copy the next time a process starts.
 *
 * **Ids and names are swapped by value.** Every primary-key uuid the shop owns
 * is replaced, wherever it appears in a row, a jsonb column included, and the
 * old slug and name are replaced by the new shop's. Ids that name rows the shop
 * does not own (the dive-site catalog, say) stay as they are.
 *
 * **The capture proves itself before it is trusted.** It writes the copy back
 * once, in a savepoint it then rolls back: the database refuses a unique value
 * the swap missed (a token) or a key left pointing at nothing, and the new
 * shop must own exactly as many rows, table by table, as the source did. Any
 * failure is logged and that day's mints build for real, as they always did.
 *
 * **A copy serves one shop-local day.** The seed's dates are relative to the
 * day it ran, so a process that outlives midnight builds again.
 *
 * Only the visitor's one-click demo comes through here. A private test shop, a
 * pinned slug, a lean schedule: `createDemoShop` directly.
 */

type Captured = { name: string; columns: string; json: string };

type Template = {
  day: string;
  slug: string;
  name: string;
  ownerEmail: string;
  /** Parents first. */
  tables: Captured[];
  /** Unique columns holding a value no shop-specific swap changes: a random token. */
  tokens: { table: string; column: string }[];
  /** Numbered keys a foreign key names, which take fresh numbers from their sequence. */
  numbered: Numbered[];
  /** Every primary-key uuid the shop owns. */
  ids: string[];
  /** Rows the shop owns, by table, for the tables that carry a `shop_id`. */
  owned: Map<string, number>;
};

type Numbered = {
  table: string;
  column: string;
  /** Every column naming it, itself and a self-reference included. */
  refs: { table: string; column: string }[];
};

type Entry = { day: string; template: Template } | { day: string; refused: string };

// One entry per database, like `demo-reset-snapshot`: the copy is of rows that
// live in that database.
const entries = new WeakMap<object, Entry>();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const IDENTITY_ATTEMPTS = 5;

class Verified extends Error {}
class ShopGone extends Error {}

// Databases a copy is being taken from, so one build at a time does it.
const capturing = new WeakSet<object>();

export type MintedDemo = { slug: string; ownerEmail: string };

/**
 * Mint a visitor's demo shop, from the copy when this process has one for
 * today and by building it when it does not. A build hands the copy to `defer`
 * (the action's `after()`), so the visitor never waits for it: it reads the
 * shop back in a transaction of its own once the response is on its way.
 */
export async function mintDemoShop(
  db: AppDb,
  opts: {
    onTiming?: (phase: string, durationMs: number) => void;
    defer: (work: () => Promise<void>) => void;
  },
): Promise<MintedDemo> {
  const day = shopDayOf(nowDate(), DEMO_SHOP_TIMEZONE);
  const known = entries.get(db);
  if (known && known.day === day && "template" in known) {
    const { template } = known;
    return db.transaction(async (tx) => {
      const started = performance.now();
      await enforceMintedDemoCap(tx);
      const capped = performance.now();
      opts.onTiming?.("mint.cap", capped - started);
      const minted = await writeCopy(tx, template);
      opts.onTiming?.("mint.clone", performance.now() - capped);
      return minted;
    });
  }
  const minted = await db.transaction(async (tx) =>
    createDemoShop(tx, { brand: true, onTiming: opts.onTiming }),
  );
  if ((!known || known.day !== day) && !capturing.has(db)) {
    capturing.add(db);
    opts.defer(async () => {
      try {
        const template = await db.transaction((tx) => capture(tx, minted, day));
        entries.set(db, { day, template });
      } catch (error) {
        // A shop already gone (the next e2e reset purged it) says nothing about
        // the copy; the next mint tries again.
        if (!(error instanceof ShopGone)) {
          const reason = refusalReason(error);
          entries.set(db, { day, refused: reason });
          log("demo_template.refused", "warn", { message: reason });
        }
      } finally {
        capturing.delete(db);
      }
    });
  }
  return minted;
}

/** The database's own words when a query failed, never the statement, which names every column. */
function refusalReason(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const text =
    cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
  return text.slice(0, 300);
}

/** Read back everything the shop `minted` owns, and prove it can be written again. */
async function capture(tx: DbExecutor, minted: MintedDemo, day: string): Promise<Template> {
  const [shop] = await rows<{ id: string; name: string }>(
    tx,
    sql`select id, name from public.shops where slug = ${minted.slug}`,
  );
  if (!shop) throw new ShopGone("the minted shop is not there to copy");
  const tables = await readTables(tx);
  const keys = await readForeignKeys(tx);

  const copies = new Map<string, string>();
  for (const [index, table] of tables.entries()) {
    const copy = `demo_copy_${index}`;
    copies.set(table.name, copy);
    await tx.execute(
      sql.raw(
        `create temp table ${copy} on commit drop as select * from ${pub(table.name)} where false`,
      ),
    );
  }
  try {
    await tx.execute(
      sql.raw(
        `insert into ${copies.get("shops")} select * from public.shops where id = ${literal(shop.id)}`,
      ),
    );
    await tx.execute(sql.raw(closure(tables, keys, copies)));

    const withShop = tables.filter((table) => table.columns.includes("shop_id"));
    const owned = await ownedCounts(tx, withShop, shop.id);
    for (const table of withShop) {
      const captured = await count(tx, `select count(*) from ${copies.get(table.name)}`);
      if (captured !== owned.get(table.name)) {
        throw new Error(
          `${table.name} has ${owned.get(table.name)} rows naming the shop and ${captured} reachable through keys`,
        );
      }
    }

    // A key the database numbers itself is left to it when nothing names it,
    // and renumbered from its sequence when a foreign key does.
    const numbered: Numbered[] = [];
    for (const table of tables) {
      for (const column of table.sequenced) {
        const refs = keys.flatMap((key) =>
          key.parent === table.name && key.parentColumns.includes(column)
            ? [
                {
                  table: key.child,
                  column: key.childColumns[key.parentColumns.indexOf(column)] as string,
                },
              ]
            : [],
        );
        if (refs.length > 0) {
          numbered.push({
            table: table.name,
            column,
            refs: [{ table: table.name, column }, ...refs],
          });
        }
      }
    }

    const unique = await rows<{ table: string; column: string }>(
      tx,
      sql`select c.relname as table, a.attname as column
          from pg_index i join pg_class c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
          where n.nspname = 'public' and i.indisunique and not i.indisprimary
            and i.indnkeyatts = 1 and i.indexprs is null`,
    );

    const dumped = await rows<{ name: string; json: string; ids: string[] }>(
      tx,
      sql.raw(
        tables
          .map((table) => {
            const copy = copies.get(table.name);
            const key =
              table.primaryKey.length === 1
                ? `array(select ${q(table.primaryKey[0] as string)}::text from ${copy})`
                : "array[]::text[]";
            return `select ${literal(table.name)} as name, coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)::text as json, ${key} as ids from ${copy} c`;
          })
          .join(" union all "),
      ),
    );
    const byName = new Map(dumped.map((row) => [row.name, row]));
    const ordered = parentsFirst(tables.filter((table) => byName.get(table.name)?.json !== "[]"));
    const template: Template = {
      day,
      slug: minted.slug,
      name: shop.name,
      ownerEmail: minted.ownerEmail,
      numbered,
      tokens: unique,
      tables: ordered.map((table) => ({
        name: table.name,
        columns: table.columns
          .filter(
            (column) =>
              !table.sequenced.includes(column) ||
              numbered.some((n) => n.table === table.name && n.column === column),
          )
          .map(q)
          .join(", "),
        json: (byName.get(table.name) as { json: string }).json,
      })),
      ids: [
        ...new Set(
          [...byName.values()].flatMap((row) => row.ids.filter((id) => /^[0-9a-f-]{36}$/.test(id))),
        ),
      ],
      owned: new Map([...owned].filter(([, rowsOwned]) => rowsOwned > 0)),
    };

    // The proof. The database checks every unique value and key; the copy must
    // also own what the source did.
    try {
      await tx.transaction(async (savepoint) => {
        const copied = await writeCopy(savepoint, template);
        const [again] = await rows<{ id: string }>(
          savepoint,
          sql`select id from public.shops where slug = ${copied.slug}`,
        );
        const written = await ownedCounts(savepoint, withShop, (again as { id: string }).id);
        for (const [name, rowsOwned] of template.owned) {
          if (written.get(name) !== rowsOwned) {
            throw new Error(
              `a copy of the shop owns ${written.get(name)} ${name} rows, not ${rowsOwned}`,
            );
          }
        }
        throw new Verified();
      });
    } catch (error) {
      if (!(error instanceof Verified)) throw error;
    }
    return template;
  } finally {
    for (const copy of copies.values()) await tx.execute(sql.raw(`drop table if exists ${copy}`));
  }
}

/** Write `template` back as a new shop, under a fresh identity and fresh ids. */
async function writeCopy(tx: DbExecutor, template: Template): Promise<MintedDemo> {
  const identity = await freshIdentity(tx);
  const fresh = new Map(template.ids.map((id) => [id, crypto.randomUUID()]));
  const name = jsonText(template.name);
  const swap = (text: string) =>
    text
      .replace(UUID, (id) => fresh.get(id) ?? id)
      .replaceAll(template.slug, identity.slug)
      .replaceAll(name, jsonText(identity.name));
  const swapValue = (value: string) =>
    value
      .replace(UUID, (id) => fresh.get(id) ?? id)
      .replaceAll(template.slug, identity.slug)
      .replaceAll(template.name, identity.name);
  const json = await renumbered(tx, template);
  freshTokens(json, template, swapValue);
  for (const table of template.tables) {
    const target = pub(table.name);
    await tx.execute(
      sql`insert into ${sql.raw(target)} (${sql.raw(table.columns)}) select ${sql.raw(table.columns)} from jsonb_populate_recordset(null::${sql.raw(target)}, ${swap(json.get(table.name) as string)}::jsonb)`,
    );
  }
  return {
    slug: identity.slug,
    ownerEmail: template.ownerEmail.replaceAll(template.slug, identity.slug),
  };
}

/**
 * A unique column the swap leaves as it was is a random token (an inbound mail
 * address, a confirmation hash): two shops cannot share one, and nothing reads a
 * demo's, so it takes a new random value of the same shape.
 */
function freshTokens(
  json: Map<string, string>,
  template: Template,
  swapValue: (value: string) => string,
): void {
  for (const [name, columns] of Map.groupBy(template.tokens, (token) => token.table)) {
    const text = json.get(name);
    if (text === undefined) continue;
    const list: Record<string, unknown>[] = JSON.parse(text);
    for (const { column } of columns) {
      for (const row of list) {
        const value = row[column];
        if (typeof value !== "string" || swapValue(value) !== value) continue;
        row[column] = randomLike(value);
      }
    }
    json.set(name, JSON.stringify(list));
  }
}

function randomLike(value: string): string {
  if (new RegExp(`^${UUID.source}$`).test(value)) return crypto.randomUUID();
  const hex = /^[0-9a-f]+$/.test(value);
  if (!hex && !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("a unique value of an unknown shape");
  const alphabet = hex
    ? "0123456789abcdef"
    : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = crypto.getRandomValues(new Uint8Array(value.length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * The copy's rows as text, the numbered keys among them given fresh numbers
 * from their sequence (and every column naming them), in the old order.
 */
async function renumbered(tx: DbExecutor, template: Template): Promise<Map<string, string>> {
  const json = new Map(template.tables.map((table) => [table.name, table.json]));
  for (const { table, column, refs } of template.numbered) {
    const parsed = new Map<string, Record<string, unknown>[]>();
    for (const name of new Set(refs.map((ref) => ref.table))) {
      parsed.set(name, JSON.parse(json.get(name) as string));
    }
    const old = [
      ...new Set(
        (parsed.get(table) as Record<string, unknown>[]).map((row) => Number(row[column])),
      ),
    ].sort((a, b) => a - b);
    if (old.length === 0) continue;
    const given = await rows<{ id: string | number }>(
      tx,
      sql`select nextval(pg_get_serial_sequence(${pub(table)}, ${column})) as id from generate_series(1, ${old.length})`,
    );
    const fresh = new Map(old.map((id, i) => [id, Number(given[i]?.id)]));
    for (const ref of refs) {
      for (const row of parsed.get(ref.table) as Record<string, unknown>[]) {
        const value = row[ref.column];
        if (value !== null && value !== undefined) row[ref.column] = fresh.get(Number(value));
      }
    }
    for (const [name, list] of parsed) json.set(name, JSON.stringify(list));
  }
  return json;
}

/** A name and slug no shop holds. The shop row's own unique index is the last word. */
async function freshIdentity(tx: DbExecutor) {
  for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
    const identity = generateDemoShopIdentity();
    const [taken] = await rows<{ taken: boolean }>(
      tx,
      sql`select true as taken from public.shops where slug = ${identity.slug} or name = ${identity.name} limit 1`,
    );
    if (!taken) return identity;
  }
  throw new Error(`no free demo shop name after ${IDENTITY_ATTEMPTS} attempts`);
}

function jsonText(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

/**
 * One PL/pgSQL block: every row that names a copied row through a foreign key,
 * until nothing is added. Keys run child-ward only, so a row the shop merely
 * points at (the dive-site catalog) is never copied.
 */
function closure(tables: Table[], keys: ForeignKey[], copies: Map<string, string>): string {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const steps = keys.map((key) => {
    const child = byName.get(key.child) as Table;
    const same =
      child.primaryKey.length > 0
        ? child.primaryKey.map((c) => `x.${q(c)} = c.${q(c)}`).join(" and ")
        : "x::text = c::text";
    const named = key.childColumns.map((c) => `c.${q(c)} is not null`).join(" and ");
    const matching = key.childColumns
      .map((c, i) => `p.${q(key.parentColumns[i] as string)} = c.${q(c)}`)
      .join(" and ");
    return `insert into ${copies.get(key.child)} select c.* from ${pub(key.child)} c where ${named} and exists (select 1 from ${copies.get(key.parent)} p where ${matching}) and not exists (select 1 from ${copies.get(key.child)} x where ${same}); get diagnostics n = row_count; if n > 0 then grew := true; end if;`;
  });
  return `do $closure$ declare n bigint; grew boolean; begin loop grew := false; ${steps.join(" ")} exit when not grew; end loop; end $closure$`;
}

async function ownedCounts(
  tx: DbExecutor,
  tables: Table[],
  shopId: string,
): Promise<Map<string, number>> {
  if (tables.length === 0) return new Map();
  const found = await rows<{ name: string; owned: string | number }>(
    tx,
    sql.raw(
      tables
        .map(
          (table) =>
            `select ${literal(table.name)} as name, count(*) as owned from ${pub(table.name)} where shop_id = ${literal(shopId)}`,
        )
        .join(" union all "),
    ),
  );
  return new Map(found.map((row) => [row.name, Number(row.owned)]));
}

/** Order tables so every foreign key's target is written before the row naming it. */
function parentsFirst(tables: Table[]): Table[] {
  const pending = new Map(tables.map((table) => [table.name, table]));
  const ordered: Table[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((table) =>
      table.parents.every((parent) => parent === table.name || !pending.has(parent)),
    );
    if (ready.length === 0) {
      throw new Error(`foreign-key cycle among ${[...pending.keys()].sort().join(", ")}`);
    }
    for (const table of ready) {
      ordered.push(table);
      pending.delete(table.name);
    }
  }
  return ordered;
}
