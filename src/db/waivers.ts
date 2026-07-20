import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { localTypedConsentProvider } from "@/lib/signatures";
import {
  createWaiverToken,
  hashWaiverToken,
  needsMedicalReview,
  WAIVER_LINK_TTL_MS,
} from "@/lib/waivers";
import type { AppDb, DbExecutor } from "./client";
import type { MedicalAnswers } from "./schema";
import { bookings, people, trips, waiverRecords, waiverTemplates } from "./schema";

export type SaveWaiverTemplateInput = {
  shopId: string;
  title: string;
  body: string;
};

/**
 * A shop has exactly one waiver, kept as an append-only chain of versions. The
 * most recent version is what a newly issued link snapshots.
 */
export async function getCurrentWaiverTemplate(db: DbExecutor, shopId: string) {
  const [template] = await db
    .select()
    .from(waiverTemplates)
    .where(and(eq(waiverTemplates.shopId, shopId), isNull(waiverTemplates.archivedAt)))
    .orderBy(desc(waiverTemplates.createdAt))
    .limit(1);
  return template ?? null;
}

/** The full version history, newest first, for a read-only audit trail. */
export async function listWaiverTemplateHistory(db: DbExecutor, shopId: string) {
  return db
    .select()
    .from(waiverTemplates)
    .where(and(eq(waiverTemplates.shopId, shopId), isNull(waiverTemplates.archivedAt)))
    .orderBy(desc(waiverTemplates.version));
}

/**
 * Saves an edit as the next version. Versions increment per shop — history reads
 * v1 → v2 → v3 — and the most recent version is always what new links snapshot.
 * The previous version stays intact so a record already signed against it is never rewritten.
 */
export async function saveWaiverTemplate(db: AppDb, input: SaveWaiverTemplateInput) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ version: waiverTemplates.version })
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, input.shopId));
    const nextVersion = Math.max(0, ...existing.map((row) => row.version)) + 1;
    const [template] = await tx
      .insert(waiverTemplates)
      .values({
        shopId: input.shopId,
        title: input.title.trim(),
        body: input.body.trim(),
        version: nextVersion,
      })
      .returning();
    if (!template) throw new Error("saveWaiverTemplate: insert returned no row");
    return template;
  });
}

export type IssueWaiverOutcome =
  | { ok: true; token: string; expiresAt: Date; recordId: string }
  | {
      ok: false;
      reason:
        | "booking_not_found"
        | "booking_unavailable"
        | "template_not_found"
        | "already_completed";
    };

/**
 * Creates a new pending record from the shop default rather than accepting a
 * caller-selected template. Reissuing
 * a pending link supersedes it, so an old token can never complete later.
 */
export async function issueWaiverRequest(
  db: AppDb,
  input: { shopId: string; bookingId: string; now?: Date },
): Promise<IssueWaiverOutcome> {
  const now = input.now ?? new Date();
  const token = createWaiverToken();
  const tokenHash = hashWaiverToken(token);
  const expiresAt = new Date(now.getTime() + WAIVER_LINK_TTL_MS);

  return db.transaction(async (tx): Promise<IssueWaiverOutcome> => {
    const [booking] = await tx
      .select({ id: bookings.id, tripStatus: trips.status })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (!booking) return { ok: false, reason: "booking_not_found" };
    if (booking.tripStatus !== "scheduled") return { ok: false, reason: "booking_unavailable" };

    const [template] = await tx
      .select()
      .from(waiverTemplates)
      .where(and(eq(waiverTemplates.shopId, input.shopId), isNull(waiverTemplates.archivedAt)))
      .orderBy(desc(waiverTemplates.createdAt))
      .limit(1);
    if (!template) return { ok: false, reason: "template_not_found" };

    const current = await tx
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.bookingId, booking.id), isNull(waiverRecords.supersededAt)));
    if (current.some((record) => record.status !== "pending")) {
      return { ok: false, reason: "already_completed" };
    }
    if (current.length > 0) {
      await tx
        .update(waiverRecords)
        .set({ supersededAt: now })
        .where(and(eq(waiverRecords.bookingId, booking.id), isNull(waiverRecords.supersededAt)));
    }

    const [record] = await tx
      .insert(waiverRecords)
      .values({
        shopId: input.shopId,
        bookingId: booking.id,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateBody: template.body,
        tokenHash,
        expiresAt,
      })
      .returning();
    if (!record) throw new Error("issueWaiverRequest: insert returned no row");
    return { ok: true, token, expiresAt, recordId: record.id };
  });
}

export type TokenWaiverState =
  | { state: "unavailable" }
  | { state: "expired" }
  | { state: "available"; record: typeof waiverRecords.$inferSelect }
  | { state: "completed"; record: typeof waiverRecords.$inferSelect };

async function currentRecordForToken(db: AppDb, token: string) {
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(
      and(eq(waiverRecords.tokenHash, hashWaiverToken(token)), isNull(waiverRecords.supersededAt)),
    )
    .limit(1);
  return record ?? null;
}

/** A bearer token reveals only its own record and is rejected on expiry/supersession. */
export async function getWaiverForToken(
  db: AppDb,
  token: string,
  now: Date = new Date(),
): Promise<TokenWaiverState> {
  const record = await currentRecordForToken(db, token);
  if (!record) return { state: "unavailable" };
  if (record.status !== "pending") return { state: "completed", record };
  if (record.expiresAt <= now) return { state: "expired" };
  return { state: "available", record };
}

export async function saveWaiverDraft(
  db: AppDb,
  token: string,
  input: { signerName?: string; acknowledged: boolean; medicalAnswers: MedicalAnswers; now?: Date },
): Promise<boolean> {
  const state = await getWaiverForToken(db, token, input.now);
  if (state.state !== "available") return false;
  const now = input.now ?? new Date();
  const [saved] = await db
    .update(waiverRecords)
    .set({
      startedAt: state.record.startedAt ?? now,
      draftSignerName: input.signerName?.trim() || null,
      draftAcknowledged: input.acknowledged,
      draftMedicalAnswers: input.medicalAnswers,
    })
    .where(and(eq(waiverRecords.id, state.record.id), eq(waiverRecords.status, "pending")))
    .returning({ id: waiverRecords.id });
  return Boolean(saved);
}

export type CompleteWaiverOutcome =
  | { ok: true; status: "completed" | "medical_review"; idempotent: boolean }
  | { ok: false; reason: "unavailable" | "expired" | "invalid_signature" };

function completedStatus(
  status: typeof waiverRecords.$inferSelect.status,
): "completed" | "medical_review" {
  return status === "medical_review" ? "medical_review" : "completed";
}

export async function completeWaiver(
  db: AppDb,
  token: string,
  input: { signerName: string; agreed: boolean; medicalAnswers: MedicalAnswers; now?: Date },
): Promise<CompleteWaiverOutcome> {
  const now = input.now ?? new Date();
  const evidence = localTypedConsentProvider.capture({
    signerName: input.signerName,
    agreed: input.agreed,
    signedAt: now,
  });
  if (!evidence) return { ok: false, reason: "invalid_signature" };

  const state = await getWaiverForToken(db, token, now);
  if (state.state === "unavailable") return { ok: false, reason: "unavailable" };
  if (state.state === "expired") return { ok: false, reason: "expired" };
  if (state.state === "completed") {
    return { ok: true, status: completedStatus(state.record.status), idempotent: true };
  }

  const medicalReviewRequired = needsMedicalReview(input.medicalAnswers);
  const status = medicalReviewRequired ? ("medical_review" as const) : ("completed" as const);
  const [saved] = await db
    .update(waiverRecords)
    .set({
      status,
      signedName: evidence.signerName,
      signatureMethod: evidence.method,
      consentedAt: evidence.consentedAt,
      signedAt: evidence.signedAt,
      medicalAnswers: input.medicalAnswers,
      medicalReviewRequired,
      completedAt: now,
    })
    .where(and(eq(waiverRecords.id, state.record.id), eq(waiverRecords.status, "pending")))
    .returning({ id: waiverRecords.id, status: waiverRecords.status });
  if (saved) return { ok: true, status: completedStatus(saved.status), idempotent: false };

  // Another submit won the race. Do not overwrite its evidence; report that
  // stable result instead, which makes duplicate browser submits harmless.
  const current = await currentRecordForToken(db, token);
  if (current?.status === "completed" || current?.status === "medical_review") {
    return { ok: true, status: completedStatus(current.status), idempotent: true };
  }
  return { ok: false, reason: "unavailable" };
}

/** Staff roster view: only the current record joins each active booking. */
export async function listTripWaiverStatuses(db: DbExecutor, shopId: string, tripId: string) {
  return db
    .select({ booking: bookings, person: people, waiver: waiverRecords })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      waiverRecords,
      and(eq(waiverRecords.bookingId, bookings.id), isNull(waiverRecords.supersededAt)),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt));
}

/**
 * Full evidence history for a staff timeline. Unlike the roster status query,
 * this deliberately includes superseded pending links so a replacement is
 * explainable without exposing its bearer token.
 */
export async function listTripWaiverActivity(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ booking: bookings, person: people, waiver: waiverRecords })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      waiverRecords,
      and(eq(waiverRecords.bookingId, bookings.id), eq(waiverRecords.shopId, shopId)),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(waiverRecords.createdAt));
}
