import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { SesBounceReport } from "@/lib/notifications/ses-events";
import type { AppDb, DbExecutor } from "./client";
import { emailBounces, people, shops } from "./schema";

/**
 * Keep every bounce and complaint SES reported (`email_bounces`). A
 * redelivered SNS event is the same row, so this inserts once per message,
 * recipient and event. A shop or sender id that names no row (a tag on mail
 * from a reaped demo shop, a deleted person) is kept as null rather than
 * losing the bounce over a foreign key.
 */
export async function recordEmailBounces(
  db: AppDb,
  reports: readonly SesBounceReport[],
): Promise<number> {
  if (reports.length === 0) return 0;
  const shopIds = [...new Set(reports.flatMap((report) => (report.shopId ? [report.shopId] : [])))];
  const personIds = [
    ...new Set(reports.flatMap((report) => (report.sentByPersonId ? [report.sentByPersonId] : []))),
  ];
  const knownShops = new Set(
    shopIds.length
      ? (await db.select({ id: shops.id }).from(shops).where(inArray(shops.id, shopIds))).map(
          (row) => row.id,
        )
      : [],
  );
  const knownPeople = new Set(
    personIds.length
      ? (
          await db
            .select({ id: people.id })
            .from(people)
            // diveday:allow-deleted-people: an id the send tagged; a removed sender still sent it
            .where(inArray(people.id, personIds))
        ).map((row) => row.id)
      : [],
  );
  const inserted = await db
    .insert(emailBounces)
    .values(
      reports.map((report) => ({
        shopId: report.shopId && knownShops.has(report.shopId) ? report.shopId : null,
        providerMessageId: report.providerMessageId,
        event: report.event,
        recipient: report.recipient,
        bounceType: report.bounceType,
        bounceSubType: report.bounceSubType,
        smtpStatus: report.smtpStatus,
        complaintType: report.complaintType,
        kind: report.kind,
        purpose: report.purpose,
        sentByPersonId:
          report.sentByPersonId && knownPeople.has(report.sentByPersonId)
            ? report.sentByPersonId
            : null,
        occurredAt: report.occurredAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: emailBounces.id });
  return inserted.length;
}

export type EmailBounceLine = {
  occurredAt: Date;
  event: "bounce" | "complaint";
  recipient: string;
  bounceType: string | null;
  bounceSubType: string | null;
  smtpStatus: string | null;
  complaintType: string | null;
  kind: string | null;
  purpose: string | null;
  shopName: string | null;
  shopSlug: string | null;
  sentByName: string | null;
};

/**
 * The bounces and complaints in `[startsAt, endsAt)`, newest first, with the
 * shop and the staff member who sent each one, for the founder's digest.
 * `limit` caps the list; `total` is the whole count.
 */
export async function listEmailBounces(
  db: DbExecutor,
  range: { startsAt: Date; endsAt: Date },
  limit = 50,
): Promise<{ total: number; lines: EmailBounceLine[] }> {
  const inRange = and(
    gte(emailBounces.occurredAt, range.startsAt),
    lt(emailBounces.occurredAt, range.endsAt),
  );
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(emailBounces)
    .where(inRange);
  const rows = await db
    .select({
      occurredAt: emailBounces.occurredAt,
      event: emailBounces.event,
      recipient: emailBounces.recipient,
      bounceType: emailBounces.bounceType,
      bounceSubType: emailBounces.bounceSubType,
      smtpStatus: emailBounces.smtpStatus,
      complaintType: emailBounces.complaintType,
      kind: emailBounces.kind,
      purpose: emailBounces.purpose,
      shopName: shops.name,
      shopSlug: shops.slug,
      sentByName: people.fullName,
    })
    .from(emailBounces)
    .leftJoin(shops, eq(shops.id, emailBounces.shopId))
    // diveday:allow-deleted-people: the name of whoever sent mail that bounced, removed since or not
    .leftJoin(people, eq(people.id, emailBounces.sentByPersonId))
    .where(inRange)
    .orderBy(desc(emailBounces.occurredAt))
    .limit(limit);
  return {
    total,
    lines: rows.map((row) => ({
      ...row,
      event: row.event === "complaint" ? "complaint" : "bounce",
    })),
  };
}
