import { type SQL, sql } from "drizzle-orm";

/**
 * The next value of an offline meeting or assignment generation.
 *
 * A generation is a fingerprint of one state of a meeting or seat, not a counter. A restore
 * rewinds every counter the database holds, so after a rewind a plain `+ 1` hands the same number
 * to a different edit, and a witness a device captured from the lost branch would match the
 * restored one. A random step across the whole range makes the rewound branch draw a fresh number, except by a
 * chance of about one in two billion per edit, so that device's evidence no longer matches and
 * stays for review. Equality is the only comparison made on it;
 * order means nothing. The step stays inside `integer`.
 */
export function nextOfflineGeneration(current: SQL | SQL.Aliased | object): SQL<number> {
  return sql<number>`((${current}::bigint + 1 + floor(random() * 2147483646)::bigint) % 2147483647)::integer`;
}
