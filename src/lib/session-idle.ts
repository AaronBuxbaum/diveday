import { DAY_MS } from "@/lib/clock";

/**
 * Staff sessions expire after a week without recorded input (#4063): the
 * counter tablet stays signed in across days off. Better Auth's own session
 * lifetime (seven days by default) is the same week.
 */
export const STAFF_IDLE_LIMIT_MS = 7 * DAY_MS;
