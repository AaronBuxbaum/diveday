import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { inPersonAttestationProvider, localTypedConsentProvider } from "@/lib/signatures";
import {
  createWaiverToken,
  hashWaiverToken,
  needsMedicalReview,
  WAIVER_LINK_TTL_MS,
} from "@/lib/waivers";
import type { AppDb, DbExecutor } from "./client";
import type { MedicalAnswers } from "./schema";
import { bookings, people, personRoles, trips, waiverRecords, waiverTemplates } from "./schema";

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
  const now = input.now ?? nowDate();
  const token = createWaiverToken();
  const tokenHash = hashWaiverToken(token);
  const expiresAt = new Date(now.getTime() + WAIVER_LINK_TTL_MS);

  return db.transaction(async (tx): Promise<IssueWaiverOutcome> => {
    const [booking] = await tx
      .select({ id: bookings.id, personId: bookings.personId, tripStatus: trips.status })
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
        personId: booking.personId,
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
  now: Date = nowDate(),
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
  const now = input.now ?? nowDate();
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

/** Optional emergency contact captured alongside the waiver, stored on the person. */
export type EmergencyContactInput = { name?: string; phone?: string };

/**
 * Write the diver's emergency contact to their person record, but only fill
 * blanks it actually supplied — a diver who leaves a field empty must never
 * wipe a value the shop already has on file. The person is reached through the
 * record's booking, so a bearer token can only ever touch its own diver.
 */
async function saveEmergencyContact(
  db: AppDb,
  bookingId: string,
  contact: EmergencyContactInput,
): Promise<void> {
  const name = contact.name?.trim();
  const phone = contact.phone?.trim();
  if (!name && !phone) return;
  const patch: Partial<typeof people.$inferInsert> = {};
  if (name) patch.emergencyContactName = name;
  if (phone) patch.emergencyContactPhone = phone;
  const [booking] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return;
  await db.update(people).set(patch).where(eq(people.id, booking.personId));
}

/** The diver's emergency contact on file, reached through their booking. */
export async function getEmergencyContactForBooking(
  db: AppDb,
  bookingId: string,
): Promise<{ name: string | null; phone: string | null } | null> {
  const [row] = await db
    .select({
      name: people.emergencyContactName,
      phone: people.emergencyContactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}

/**
 * Save an emergency contact for a booking's diver, scoped to the shop so a
 * bearer-token surface (the `/ready` page) can only ever write to its own
 * booking's person. Blanks never overwrite an existing value.
 */
export async function saveBookingEmergencyContact(
  db: AppDb,
  input: { shopId: string; bookingId: string; name?: string; phone?: string },
): Promise<boolean> {
  const name = input.name?.trim();
  const phone = input.phone?.trim();
  if (!name && !phone) return false;
  const patch: Partial<typeof people.$inferInsert> = {};
  if (name) patch.emergencyContactName = name;
  if (phone) patch.emergencyContactPhone = phone;
  const [booking] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return false;
  const [updated] = await db
    .update(people)
    .set(patch)
    .where(eq(people.id, booking.personId))
    .returning({ id: people.id });
  return Boolean(updated);
}

export async function completeWaiver(
  db: AppDb,
  token: string,
  input: {
    signerName: string;
    agreed: boolean;
    medicalAnswers: MedicalAnswers;
    emergencyContact?: EmergencyContactInput;
    now?: Date;
  },
): Promise<CompleteWaiverOutcome> {
  const now = input.now ?? nowDate();
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
  if (saved) {
    if (input.emergencyContact) {
      await saveEmergencyContact(db, state.record.bookingId, input.emergencyContact);
    }
    return { ok: true, status: completedStatus(saved.status), idempotent: false };
  }

  // Another submit won the race. Do not overwrite its evidence; report that
  // stable result instead, which makes duplicate browser submits harmless.
  const current = await currentRecordForToken(db, token);
  if (current?.status === "completed" || current?.status === "medical_review") {
    return { ok: true, status: completedStatus(current.status), idempotent: true };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * Every *signed* release on file for a set of divers at a shop, grouped by
 * person — the evidence the sign-once rule draws on. Includes both `completed`
 * and `medical_review` records (superseded ones excluded): the caller needs the
 * medical holds too, so a stale clean signature can never carry a diver past a
 * newer, unresolved medical review. Currency (template version, age) is decided
 * per booking by `effectiveWaiverForBooking`.
 */
export async function listSignedWaiversByPerson(
  db: DbExecutor,
  shopId: string,
  personIds: string[],
): Promise<Map<string, (typeof waiverRecords.$inferSelect)[]>> {
  const byPerson = new Map<string, (typeof waiverRecords.$inferSelect)[]>();
  if (personIds.length === 0) return byPerson;
  const rows = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.personId, personIds),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
        isNull(waiverRecords.supersededAt),
      ),
    );
  for (const row of rows) {
    const list = byPerson.get(row.personId) ?? [];
    list.push(row);
    byPerson.set(row.personId, list);
  }
  return byPerson;
}

export type InPersonWaiverOutcome =
  | { ok: true; recordId: string; alreadySigned: boolean }
  | {
      ok: false;
      reason:
        | "booking_not_found"
        | "booking_unavailable"
        | "template_not_found"
        | "staff_not_found"
        | "medical_attestation_required"
        | "invalid_signature";
    };

/**
 * A staff member records that a diver signed the release on paper — a copy on
 * the boat or handed over on shore — for a diver the app never sees sign. The
 * result is the same immutable completed record a diver self-service completion
 * produces (ADR 20260718), snapshotting the current template, but marked
 * `in_person_attested` and stamped with the accountable staff member. Because
 * the record is person-scoped it carries forward like any other signature.
 *
 * The medical block is load-bearing and cannot be conjured from thin air: this
 * path records a clean release only, so the caller must pass an explicit
 * `medicalAttested` — staff affirming they reviewed the paper medical form and
 * no answer needs physician sign-off. Without it the record is refused, and a
 * flagged medical must go through the diver-facing link, which captures the
 * questionnaire and routes to review. Guards otherwise match
 * `issueWaiverRequest`: the booking must be live, the actor a staff member of
 * the shop. Idempotent — a booking already signed or in medical review keeps its
 * existing record rather than stacking a second one.
 */
export async function recordInPersonWaiver(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    recordedByPersonId: string;
    medicalAttested: boolean;
    now?: Date;
  },
): Promise<InPersonWaiverOutcome> {
  const now = input.now ?? nowDate();
  if (!input.medicalAttested) return { ok: false, reason: "medical_attestation_required" };
  return db.transaction(async (tx): Promise<InPersonWaiverOutcome> => {
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

    const [booking] = await tx
      .select({
        id: bookings.id,
        personId: bookings.personId,
        fullName: people.fullName,
        tripStatus: trips.status,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
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

    const current = await tx
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.bookingId, booking.id), isNull(waiverRecords.supersededAt)));
    const alreadyDone = current.find(
      (record) => record.status === "completed" || record.status === "medical_review",
    );
    if (alreadyDone) return { ok: true, recordId: alreadyDone.id, alreadySigned: true };

    const [template] = await tx
      .select()
      .from(waiverTemplates)
      .where(and(eq(waiverTemplates.shopId, input.shopId), isNull(waiverTemplates.archivedAt)))
      .orderBy(desc(waiverTemplates.createdAt))
      .limit(1);
    if (!template) return { ok: false, reason: "template_not_found" };

    const evidence = inPersonAttestationProvider.capture({
      signerName: booking.fullName,
      agreed: true,
      signedAt: now,
    });
    if (!evidence) return { ok: false, reason: "invalid_signature" };

    // Retire any live pending link so its bearer token can never complete a
    // second record after the shop has already recorded the paper copy.
    await tx
      .update(waiverRecords)
      .set({ supersededAt: now })
      .where(
        and(
          eq(waiverRecords.bookingId, booking.id),
          eq(waiverRecords.status, "pending"),
          isNull(waiverRecords.supersededAt),
        ),
      );

    const [record] = await tx
      .insert(waiverRecords)
      .values({
        shopId: input.shopId,
        bookingId: booking.id,
        personId: booking.personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateBody: template.body,
        status: "completed",
        // No link is ever handed out for a paper record; a random unusable hash
        // keeps the unique token column satisfied without granting bearer access.
        tokenHash: hashWaiverToken(createWaiverToken()),
        expiresAt: now,
        signedName: evidence.signerName,
        signatureMethod: evidence.method,
        recordedByPersonId: staff.id,
        consentedAt: evidence.consentedAt,
        signedAt: evidence.signedAt,
        completedAt: now,
      })
      .returning();
    if (!record) throw new Error("recordInPersonWaiver: insert returned no row");
    return { ok: true, recordId: record.id, alreadySigned: false };
  });
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
