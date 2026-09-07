import { sql } from "drizzle-orm";
import type { PlatformComponentState } from "@/lib/platform-status";
import { getDb } from "./client";

/**
 * Does the database answer, right now?
 *
 * `select 1` through the same `getDb()` every request path uses, so a green
 * answer is liveness of the pool the app actually books seats through rather
 * than of a connection opened for the occasion.
 *
 * Two callers, deliberately one function: `/api/health` (the external monitor's
 * target) and `/status` (the page a shop owner opens). They agreed by
 * coincidence until this module existed, which is the state in which a probe
 * and the page reporting on it drift apart and only the shop notices.
 *
 * Never throws, and never returns the driver's error text. The failure of a
 * database check is a *state*, not an exception, for a caller whose whole job
 * is to report states; and the message routinely carries the host, the user and
 * sometimes the password, which is exactly what neither caller may disclose.
 * Whoever wants the detail reads the log line the caller writes.
 */
export async function checkDatabase(): Promise<PlatformComponentState> {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return "up";
  } catch {
    return "down";
  }
}
