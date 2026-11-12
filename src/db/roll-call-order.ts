import { type AnyColumn, asc, desc, gt, sql } from "drizzle-orm";
import { rollCallEvents } from "./schema";

/**
 * Storage order selects the row carrying the materialized causal projection;
 * neither receipt sequence nor capture clocks establish observation or decide
 * which original statement wins (ADR 20261112-roll-call-observes-evidence).
 * Capture clocks are retained separately for audit presentation. The earlier
 * timestamp-order policy is superseded. `scripts/check-roll-call-subject.mjs`
 * refuses a hand-written sort or newer-than comparison anywhere but here; it
 * reads text, so it catches the usual shapes, not every one.
 *
 * Each helper takes the table or an `alias()` of it.
 */
type OrderedMarks = { occurredAt: AnyColumn; createdAt: AnyColumn; seq: AnyColumn };

/** Latest stored projection row; its original statement need not be the effective result. */
export function newestMarkFirst(table: OrderedMarks = rollCallEvents) {
  return [desc(table.seq)] as const;
}

/** `orderBy(...oldestMarkFirst())`: the timeline order, as the export and the incident pack read it. */
export function oldestMarkFirst(table: OrderedMarks = rollCallEvents) {
  return [asc(table.seq)] as const;
}

/** True where `newer` was recorded after `older`, for a "no newer mark exists" anti-join. */
export function isNewerMark(newer: OrderedMarks, older: OrderedMarks) {
  return gt(newer.seq, older.seq);
}

/** Original crew intent for a timeline or audit export, separate from risk projection. */
export function originalRollCallStatus() {
  return sql<
    (typeof rollCallEvents.$inferSelect)["status"]
  >`coalesce(${rollCallEvents.statementStatus}, ${rollCallEvents.status})`;
}

/** Capture timestamps order an audit trail only, never evidence supersession. */
export function auditMarkFirst(table: OrderedMarks = rollCallEvents) {
  return [asc(table.occurredAt), asc(table.createdAt), asc(table.seq)] as const;
}
