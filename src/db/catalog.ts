import { type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";

// What the catalog says about the public schema, read by the two modules that
// copy a seeded demo: `src/features/demo/demo-reset-snapshot.ts` and
// `src/features/demo/demo-template.ts`. Every name here comes from the catalog, never from a request.

/** A foreign key, read off the catalog. */
export type ForeignKey = {
  name: string;
  child: string;
  parent: string;
  /** `pg_constraint.confdeltype`: a no action, r restrict, c cascade, n set null. */
  onDelete: string;
  childColumns: string[];
  parentColumns: string[];
};

export type Table = {
  name: string;
  /** Columns a row can be written with: generated ones are left out. */
  columns: string[];
  primaryKey: string[];
  /** Columns the database fills in itself (a sequence or identity). */
  sequenced: string[];
  hasIdentity: boolean;
  /** Tables this one's foreign keys point at. */
  parents: string[];
};

export async function readTables(db: DbExecutor): Promise<Table[]> {
  const names = await rows<{ name: string }>(
    db,
    sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
  );
  const columns = await rows<{
    table: string;
    column: string;
    identity: string;
    sequenced: boolean;
  }>(
    db,
    sql`select c.relname as table, a.attname as column, a.attidentity as identity,
          (a.attidentity <> '' or coalesce(pg_get_expr(d.adbin, d.adrelid) like 'nextval(%', false))
            as sequenced
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
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
    sequenced: columns.filter((c) => c.table === name && c.sequenced).map((c) => c.column),
    hasIdentity: columns.some((c) => c.table === name && c.identity !== ""),
    primaryKey: keys.filter((k) => k.table === name).map((k) => k.column),
    parents: [...new Set(references.filter((r) => r.child === name).map((r) => r.parent))],
  }));
}

export async function readForeignKeys(db: DbExecutor): Promise<ForeignKey[]> {
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

export async function rows<T>(db: DbExecutor, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

export async function count(db: DbExecutor, query: string): Promise<number> {
  const [row] = await rows<{ count: string | number }>(db, sql.raw(query));
  return Number(row?.count ?? 0);
}

/** A quoted identifier. Every name here comes from the catalog, never from a request. */
export function q(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function pub(table: string): string {
  return `public.${q(table)}`;
}

/** A SQL string literal. */
export function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
