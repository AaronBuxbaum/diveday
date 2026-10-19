import { and, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import type { AppDb } from "./client";
import { fixture } from "./incident-reports-test-fixtures";
import { bookings, incidentReports, rollCallEvents, shops } from "./schema";

/**
 * Shared set-up for the missing-diver alert and Found tests (issue #2694):
 * a real (not demo) shop's departure with a seat marked not back aboard
 * five minutes ago, so the alert pushes too.
 */
export const MARKED_AT = new Date(nowDate().getTime() - 5 * 60 * 1000);

/** A provider that records every notification, and fails when told to. */
export function recorder(status: "sent" | "failed" = "sent") {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return status === "sent"
        ? { status: "sent", providerMessageId: `msg-${sent.length}` }
        : { status: "failed", retryable: false, errorCode: "test" };
    },
  };
  const kinds = (kind: string) => sent.filter((n) => n.kind === kind).length;
  return { sent, provider, kinds };
}

export type Fixture = Awaited<ReturnType<typeof fixture>>;

/** One after-dive roll-call mark on a seat, as the manifest records it. */
export async function mark(
  db: AppDb,
  shopId: string,
  f: Fixture,
  bookingId: string,
  status: "boarded" | "not_boarded",
  occurredAt: Date,
  source: "live" | "offline" = "live",
) {
  await db.insert(rollCallEvents).values({
    shopId,
    tripId: f.trip.id,
    bookingId,
    recordedByPersonId: f.crew.id,
    status,
    checkpoint: "after_dive_1",
    source,
    occurredAt,
  });
}

/** The fixture's departure, its seat marked not back aboard. */
export async function missingSeat(db: AppDb, shopId: string, source: "live" | "offline" = "live") {
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shopId));
  const f = await fixture(db, shopId);
  await mark(db, shopId, f, f.seat.booking.id, "not_boarded", MARKED_AT, source);
  const input = {
    shopId,
    tripId: f.trip.id,
    subject: { kind: "diver" as const, bookingId: f.seat.booking.id },
  };
  return { db, f, input };
}

/** Another seat on the fixture's departure. */
export async function secondSeat(db: AppDb, f: Fixture): Promise<string> {
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.tripId, f.trip.id), ne(bookings.id, f.seat.booking.id)))
    .limit(1);
  if (!seat) throw new Error("expected a second seat on the departure");
  return seat.id;
}

export async function stateOf(db: AppDb, reportId: string) {
  const [row] = await db
    .select({
      kind: incidentReports.kind,
      status: incidentReports.status,
      raisedAt: incidentReports.missingAlertRaisedAt,
      raisedBy: incidentReports.missingAlertRaisedByPersonId,
      subjectRowId: incidentReports.missingSubjectRowId,
      sentAt: incidentReports.missingAlertSentAt,
      foundAt: incidentReports.missingFoundAt,
      foundBy: incidentReports.missingFoundByPersonId,
      allClearClaimedAt: incidentReports.missingAllClearClaimedAt,
      allClearAt: incidentReports.missingAllClearSentAt,
      deletedAt: incidentReports.deletedAt,
    })
    .from(incidentReports)
    .where(eq(incidentReports.id, reportId));
  if (!row) throw new Error("report missing");
  return row;
}
