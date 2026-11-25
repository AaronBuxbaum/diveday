import { type SQL, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { startIncidentReport } from "@/db/incident-reports";
import { createDemoShop } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { LEAK_MARKER, type ShopAFingerprint } from "./oracle";
import type { Perspective } from "./plan";

/**
 * **Two shops in one database, and everything that marks shop A's rows.**
 *
 * Shop A is the seeded demo shop (`blue-mantis`); shop B is minted beside it
 * with `createDemoShop`. A row belongs to shop A when its `shop_id` is A's,
 * when it is A's `shops` row, or when a foreign key reaches such a row (three
 * levels down). The fixture writes a `LEAK-A-<n>` marker into A's names, notes
 * and medical free text, collects every uuid primary key of A's rows, and can
 * fingerprint A's rows table by table so a write is caught by comparison.
 */

type Shop = NonNullable<Awaited<ReturnType<typeof getShopBySlug>>>;

async function rows<T>(db: AppDb, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

type Column = { table: string; column: string; type: string };
type ForeignKey = { table: string; column: string; parent: string; parentColumn: string };

async function readCatalog(db: AppDb) {
  const columns = await rows<{ table_name: string; column_name: string; data_type: string }>(
    db,
    sql`select c.table_name, c.column_name, c.data_type
          from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
  );
  const keys = await rows<{ table_name: string; column_name: string }>(
    db,
    sql`select kcu.table_name, kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
         where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'`,
  );
  const foreign = await rows<{
    table_name: string;
    column_name: string;
    parent: string;
    parent_column: string;
  }>(
    db,
    sql`select cl.relname as table_name, a.attname as column_name,
               pcl.relname as parent, pa.attname as parent_column
          from pg_constraint con
          join pg_class cl on cl.oid = con.conrelid
          join pg_namespace n on n.oid = cl.relnamespace
          join pg_class pcl on pcl.oid = con.confrelid
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
          join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
         where con.contype = 'f' and n.nspname = 'public' and array_length(con.conkey, 1) = 1`,
  );
  return {
    columns: columns.map((c) => ({
      table: c.table_name,
      column: c.column_name,
      type: c.data_type,
    })),
    primaryKeys: keys.map((k) => ({ table: k.table_name, column: k.column_name })),
    foreignKeys: foreign.map((f) => ({
      table: f.table_name,
      column: f.column_name,
      parent: f.parent,
      parentColumn: f.parent_column,
    })),
  };
}

/** A `where` clause per table that selects shop A's rows, for every table that has any. */
function ownershipPredicates(
  shopId: string,
  columns: Column[],
  foreignKeys: ForeignKey[],
): Map<string, string> {
  const literal = `'${shopId}'::uuid`;
  const predicates = new Map<string, string>([["shops", `x.id = ${literal}`]]);
  for (const { table, column } of columns) {
    if (column === "shop_id" && table !== "shops") predicates.set(table, `x.shop_id = ${literal}`);
  }
  // Children reached by a foreign key, three levels down.
  for (let level = 0; level < 3; level++) {
    const next = new Map<string, string[]>();
    for (const fk of foreignKeys) {
      const parent = predicates.get(fk.parent);
      if (!parent || fk.table === fk.parent) continue;
      if (predicates.get(fk.table)?.startsWith("x.shop_id")) continue;
      const clause = `x.${ident(fk.column)} in (select x.${ident(fk.parentColumn)} from ${ident(fk.parent)} x where ${parent})`;
      next.set(fk.table, [...(next.get(fk.table) ?? []), clause]);
    }
    for (const [table, clauses] of next) {
      if (predicates.has(table) && predicates.get(table)?.startsWith("x.shop_id")) continue;
      predicates.set(table, clauses.map((clause) => `(${clause})`).join(" or "));
    }
  }
  return predicates;
}

/** Free text a person reads: names, titles, notes, descriptions, medical and message text. */
const MARKED_COLUMN =
  /^(full_name|name|preferred_name|title|description|body|summary|message|reason|comment|medical_alert|.*_name|notes?|.*_notes?|.*_text)$/;
const UNMARKED_COLUMN =
  /(slug|email|phone|url|token|hash|key|code|locale|zone|currency|kind|status|type)$/;

async function writeMarkers(db: AppDb, owned: Map<string, string>, columns: Column[]) {
  await db.execute(sql`create temporary sequence if not exists cross_shop_marker`);
  // Signed evidence is guarded by triggers; the fixture is not a writer of the
  // app's, so it steps past them for this one pass.
  await db.execute(sql`set local session_replication_role = replica`);
  let marked = 0;
  for (const [table, predicate] of owned) {
    const text = columns.filter(
      (c) =>
        c.table === table &&
        (c.type === "text" || c.type === "character varying") &&
        MARKED_COLUMN.test(c.column) &&
        !UNMARKED_COLUMN.test(c.column),
    );
    const medical = columns.filter(
      (c) => c.table === table && c.type === "jsonb" && c.column === "medical_answers",
    );
    for (const column of [...text, ...medical]) {
      const name = ident(column.column);
      const value =
        column.type === "jsonb"
          ? `x.${name} || jsonb_build_object('sweepNote', '${LEAK_MARKER}' || nextval('cross_shop_marker'))`
          : `x.${name} || ' ${LEAK_MARKER}' || nextval('cross_shop_marker')`;
      const guard =
        column.type === "jsonb"
          ? `jsonb_typeof(x.${name}) = 'object'`
          : `coalesce(x.${name}, '') <> ''`;
      const done = await rows<{ n: number }>(
        db,
        sql.raw(
          `with changed as (update ${ident(table)} x set ${name} = ${value} where ${predicate} and ${guard} returning 1) select count(*)::int as n from changed`,
        ),
      );
      marked += done[0]?.n ?? 0;
    }
  }
  await db.execute(sql`set local session_replication_role = origin`);
  return marked;
}

async function collectIds(
  db: AppDb,
  owned: Map<string, string>,
  columns: Column[],
  primaryKeys: { table: string; column: string }[],
): Promise<Set<string>> {
  const uuid = new Set(
    columns.filter((c) => c.type === "uuid").map((c) => `${c.table}.${c.column}`),
  );
  const selects = primaryKeys
    .filter((key) => owned.has(key.table) && uuid.has(`${key.table}.${key.column}`))
    .map(
      (key) =>
        `select x.${ident(key.column)}::text as id from ${ident(key.table)} x where ${owned.get(key.table)}`,
    );
  const ids = new Set<string>();
  for (const row of await rows<{ id: string }>(db, sql.raw(selects.join(" union all ")))) {
    ids.add(row.id);
  }
  return ids;
}

/** One fingerprint per table of shop A's rows. */
function fingerprintQuery(owned: Map<string, string>): SQL {
  const parts = [...owned].map(
    ([table, predicate]) =>
      `select '${table}' as t, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${ident(table)} x where ${predicate}`,
  );
  return sql.raw(parts.join(" union all "));
}

/**
 * One count per foreign key from a table shop B owns rows in to a table shop A
 * owns rows in: B's rows whose key points at one of A's. A write that hands
 * shop B a row tied to shop A's trip, person or site moves one of these.
 */
function crossLinkQuery(
  ownedByA: Map<string, string>,
  ownedByB: Map<string, string>,
  foreignKeys: ForeignKey[],
): SQL | null {
  const parts = foreignKeys
    // A row whose shop is A's is A's row, not a link; `shop_id` is the ownership itself.
    .filter((fk) => fk.parent !== "shops" && ownedByB.has(fk.table) && ownedByA.has(fk.parent))
    .map(
      (fk) =>
        `select '${fk.table}.${fk.column} -> ${fk.parent}' as l, count(*)::int as n from ${ident(fk.table)} x where (${ownedByB.get(fk.table)}) and x.${ident(fk.column)} in (select x.${ident(fk.parentColumn)} from ${ident(fk.parent)} x where ${ownedByA.get(fk.parent)})`,
    );
  return parts.length === 0 ? null : sql.raw(parts.join(" union all "));
}

export type TwoShops = {
  a: Shop;
  b: Shop;
  fingerprint: ShopAFingerprint;
  markers: number;
  ownedTables: number;
  /** Shop B calling with shop A's ids. */
  asB: Perspective;
  /** Shop A calling with its own ids: proves the sweep can see A's data at all. */
  asA: Perspective;
  /** Rows this transaction has inserted, updated or deleted so far, across every table. */
  writeCount(executor: AppDb): Promise<number>;
  /** The tables whose shop A rows differ from the start, read through `executor`. */
  changedTables(executor: AppDb): Promise<string[]>;
  /**
   * Foreign keys (`table.column -> parent`) on which shop B now owns more rows
   * pointing at shop A's rows than when the fixture was built.
   */
  crossLinks(executor: AppDb): Promise<string[]>;
  /** How many foreign keys `crossLinks` watches. */
  watchedLinks: number;
};

async function first(db: AppDb, query: SQL): Promise<string | undefined> {
  return (await rows<{ v: string }>(db, query))[0]?.v;
}

async function many(db: AppDb, query: SQL): Promise<string[]> {
  return (await rows<{ v: string }>(db, query)).map((row) => row.v);
}

/** Shop A's own ids, by the parameter names the sweep fills. */
async function targetsIn(db: AppDb, shopId: string): Promise<Record<string, unknown>> {
  const tripIds = await many(
    db,
    sql`select t.id::text as v from trips t where t.shop_id = ${shopId}
         order by (select count(*) from bookings b where b.trip_id = t.id) desc, t.id limit 3`,
  );
  const tripId = tripIds[0];
  const bookingIds = await many(
    db,
    sql`select b.id::text as v from bookings b where b.trip_id = ${tripId ?? null} order by b.id limit 5`,
  );
  const personIds = await many(
    db,
    sql`select distinct b.person_id::text as v from bookings b where b.trip_id = ${tripId ?? null} limit 5`,
  );
  const person = (
    await rows<{ email: string | null; phone: string | null }>(
      db,
      sql`select email, phone from people where id = ${personIds[0] ?? null}`,
    )
  )[0];
  const any = (table: string) =>
    first(
      db,
      sql.raw(
        `select id::text as v from ${ident(table)} where shop_id = '${shopId}' order by id limit 1`,
      ),
    );
  const siteIds = await many(
    db,
    sql`select id::text as v from dive_sites where shop_id = ${shopId} order by id limit 3`,
  );
  const ids: Record<string, unknown> = {
    tripId,
    tripIds,
    bookingId: bookingIds[0],
    bookingIds,
    personId: personIds[0],
    personIds,
    siteId: siteIds[0],
    siteIds,
    boatId: await any("boats"),
    courseId: await any("courses"),
    seriesId: await any("trip_series"),
    orderId: await any("orders"),
    certificationId: await any("cards"),
    gearItemId: await any("gear_items"),
    packageId: await any("dive_packages"),
    formId: await any("course_forms"),
    interestId: await any("interests"),
    reportId: await any("incident_reports"),
    blowoutId: await any("trip_blowouts"),
    reservationId: await any("gear_reservations"),
    toTripId: tripIds[1],
    email: person?.email ?? undefined,
    phone: person?.phone ?? undefined,
  };
  const aliases: Record<string, string> = {
    knownTripId: "tripId",
    expectedTripId: "tripId",
    fromTripId: "tripId",
    sourceTripId: "tripId",
    departureTripId: "tripId",
    leadBookingId: "bookingId",
    diverId: "personId",
    expectedPersonId: "personId",
    diveSiteId: "siteId",
    courseIds: "courseId",
    gearItemIds: "gearItemId",
    interestIds: "interestId",
  };
  for (const [alias, name] of Object.entries(aliases)) {
    const value = ids[name];
    ids[alias] = alias.endsWith("Ids") && typeof value === "string" ? [value] : value;
  }
  return Object.fromEntries(Object.entries(ids).filter(([, value]) => value !== undefined));
}

async function ownerOf(db: AppDb, shop: Shop) {
  const owner = (
    await rows<{ person_id: string; account_id: string | null }>(
      db,
      sql`select p.id::text as person_id, ua.id::text as account_id
            from people p
            join person_roles r on r.person_id = p.id and r.role = 'owner'
            left join user_accounts ua on ua.person_id = p.id
           where p.shop_id = ${shop.id}
           order by p.id limit 1`,
    )
  )[0];
  if (!owner) throw new Error(`cross-shop fixture: shop ${shop.slug} has no owner`);
  return owner;
}

/** Who is calling: the shop's owner, and the plain values any caller supplies. */
async function callerIn(db: AppDb, shop: Shop): Promise<Record<string, unknown>> {
  const owner = await ownerOf(db, shop);
  const caller: Record<string, unknown> = {
    actorPersonId: owner.person_id,
    recordedByPersonId: owner.person_id,
    deletedByPersonId: owner.person_id,
    viewerPersonId: owner.person_id,
    staffPersonId: owner.person_id,
    createdByPersonId: owner.person_id,
    calledByPersonId: owner.person_id,
    sentByPersonId: owner.person_id,
    userAccountId: owner.account_id ?? undefined,
    now: nowDate(),
    asOf: nowDate(),
    timeZone: shop.timezone,
    limit: 50,
    pageSize: 50,
    buddyCreditCents: 0,
    note: "Swept",
    body: "Swept",
    reason: "Swept",
    title: "Swept",
    name: "Swept",
    fullName: "Swept",
    label: "Swept",
    // Who is acting, where a write asks: the staff door is the less guarded one.
    actor: "staff",
    // A crew notice's kind of news.
    change: "assigned",
  };
  return Object.fromEntries(Object.entries(caller).filter(([, value]) => value !== undefined));
}

/** Rows the seeded demo shop has none of, so every filled name has a value of A's. */
async function addWhatTheSeedLacks(db: AppDb, a: Shop) {
  const owner = await ownerOf(db, a);
  const tripId = await first(
    db,
    sql`select id::text as v from trips where shop_id = ${a.id} and deleted_at is null
         order by starts_at desc limit 1`,
  );
  if (!tripId) throw new Error("cross-shop fixture: shop A has no trip");
  const report = await startIncidentReport(db, {
    shopId: a.id,
    tripId,
    actorPersonId: owner.person_id,
  });
  if (!report.ok) throw new Error(`cross-shop fixture: no incident report (${report.reason})`);
}

export async function buildTwoShops(db: AppDb): Promise<TwoShops> {
  const a = await getShopBySlug(db, "blue-mantis");
  if (!a) throw new Error('cross-shop fixture: seeded demo shop "blue-mantis" missing');
  const { slug } = await createDemoShop(db, { shape: "lean", slug: "cross-shop-b" });
  const b = await getShopBySlug(db, slug);
  if (!b) throw new Error("cross-shop fixture: shop B was not minted");
  await addWhatTheSeedLacks(db, a);

  const { columns, primaryKeys, foreignKeys } = await readCatalog(db);
  const owned = ownershipPredicates(a.id, columns, foreignKeys);
  const markers = await writeMarkers(db, owned, columns);
  const ids = await collectIds(db, owned, columns, primaryKeys);

  const query = fingerprintQuery(owned);
  const read = async (executor: AppDb) =>
    new Map((await rows<{ t: string; h: string }>(executor, query)).map((row) => [row.t, row.h]));
  const baseline = await read(db);

  const linkQuery = crossLinkQuery(
    owned,
    ownershipPredicates(b.id, columns, foreignKeys),
    foreignKeys,
  );
  const readLinks = async (executor: AppDb) =>
    new Map(
      linkQuery
        ? (await rows<{ l: string; n: number }>(executor, linkQuery)).map((row) => [row.l, row.n])
        : [],
    );
  const linkBaseline = await readLinks(db);

  const targets = await targetsIn(db, a.id);
  return {
    a,
    b,
    fingerprint: { ids },
    markers,
    ownedTables: owned.size,
    asB: { shop: b, values: { ...targets, ...(await callerIn(db, b)) } },
    asA: { shop: a, values: { ...targets, ...(await callerIn(db, a)) } },
    async writeCount(executor) {
      const counted = await rows<{ n: string | number }>(
        executor,
        sql`select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) as n from pg_stat_xact_user_tables`,
      );
      return Number(counted[0]?.n ?? 0);
    },
    async changedTables(executor) {
      const now = await read(executor);
      return [...baseline].filter(([table, hash]) => now.get(table) !== hash).map(([t]) => t);
    },
    async crossLinks(executor) {
      const now = await readLinks(executor);
      return [...now].filter(([link, n]) => n > (linkBaseline.get(link) ?? 0)).map(([l]) => l);
    },
    watchedLinks: linkBaseline.size,
  };
}

/** Every parameter name the sweep fills; the sweep test checks each has a value. */
export const FILLABLE_NAMES: ReadonlySet<string> = new Set([
  "tripId",
  "tripIds",
  "bookingId",
  "bookingIds",
  "personId",
  "personIds",
  "siteId",
  "siteIds",
  "boatId",
  "courseId",
  "seriesId",
  "orderId",
  "certificationId",
  "gearItemId",
  "packageId",
  "formId",
  "interestId",
  "reportId",
  "blowoutId",
  "reservationId",
  "toTripId",
  "email",
  "phone",
  "knownTripId",
  "expectedTripId",
  "fromTripId",
  "sourceTripId",
  "departureTripId",
  "leadBookingId",
  "diverId",
  "expectedPersonId",
  "diveSiteId",
  "courseIds",
  "gearItemIds",
  "interestIds",
  "actorPersonId",
  "recordedByPersonId",
  "deletedByPersonId",
  "viewerPersonId",
  "staffPersonId",
  "createdByPersonId",
  "calledByPersonId",
  "sentByPersonId",
  "userAccountId",
  "now",
  "asOf",
  "timeZone",
  "limit",
  "pageSize",
  "buddyCreditCents",
  "note",
  "body",
  "reason",
  "title",
  "name",
  "fullName",
  "label",
  "actor",
  "change",
]);
