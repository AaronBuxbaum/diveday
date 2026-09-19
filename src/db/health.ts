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
 * One caller today — `/status`, the page a shop owner opens — and the dev
 * server's warm reaches it through that page. `/api/health` was the second
 * until ADR 20260919-health-check-does-not-wake-the-database: a Route 53 check
 * lands on that route about every two seconds once every checker region is
 * counted, and a `select 1` at that cadence means a serverless compute that
 * never reaches its five-minute idle timeout and never scales to zero. The
 * function stays shared rather than being inlined into the page, because the
 * moment a second caller wants this question it must get the same answer: a
 * probe and the page reporting on it drifting apart is the state in which only
 * the shop notices.
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
