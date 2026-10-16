import { getTableName } from "drizzle-orm";
import * as schema from "@/db/schema";

/**
 * The database name of a schema export, or null when it is not a table.
 * `getTableName` throws on some of what the schema module exports that is not a
 * table and answers nothing for the rest (the enums, the views, the relations),
 * so both read as null.
 */
function tableNameOf(value: unknown): string | null {
  try {
    const name: unknown = getTableName(value as Parameters<typeof getTableName>[0]);
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** The database name of the schema export called `identifier`, or null. */
export function schemaTableNameOf(identifier: string): string | null {
  return tableNameOf((schema as Record<string, unknown>)[identifier]);
}

/** Every table in the schema, by its database name. */
export function schemaTableNames(): string[] {
  return Object.values(schema)
    .map(tableNameOf)
    .filter((name): name is string => name !== null);
}
