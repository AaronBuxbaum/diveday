import { HOUR_MS } from "@/lib/clock";

/** Staff sessions expire after one working day without recorded input. */
export const STAFF_IDLE_LIMIT_MS = 12 * HOUR_MS;
