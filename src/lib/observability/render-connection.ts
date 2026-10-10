import { after, connection } from "next/server";
import { reportRenderQueries } from "./query-timing";

/**
 * `await connection()` for a page that also names its render pass, so the
 * `render.db_queries` line it logs after the response says which route it was.
 * One line in the route file in place of two.
 */
export async function connectionForRoute(
  route: string,
  options?: { fallback?: boolean },
): Promise<void> {
  await connection();
  reportRenderQueries(route, after, options);
}
