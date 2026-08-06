import { and, asc, count, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { flaggedMedicalPrompts, validateMedicalAnswers } from "@/lib/medical";
import { personNamesMatch } from "@/lib/person-name";
import { inPersonAttestationProvider, localTypedConsentProvider } from "@/lib/signatures";
import { computeWaiverIntegrityHash, verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import {
  createWaiverToken,
  hashWaiverToken,
  needsMedicalReview,
  WAIVER_LINK_TTL_MS,
} from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage } from "./paging";
import type { MedicalAnswers } from "./schema";
import { bookings, people, shops, trips, waiverRecords, waiverTemplates } from "./schema";

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

/** How many audit rows the Signatures tab shows per page. */
export const WAIVER_INTEGRITY_PAGE_SIZE = 20;

/** The join shape both `listWaiverIntegrityAudit` and `getSignedWaiverRecordForShop` select. */
type WaiverAuditJoinRow = {
  record: typeof waiverRecords.$inferSelect;
  personName: string;
  tripId: string | null;
  tripTitle: string | null;
  tripStartsAt: Date | null;
};

/**
 * Shared row shaping for the Signatures tab: never the bearer token, never
 * the raw medical questionnaire — a medical hold surfaces only as
 * `flaggedPrompts`, the "answered yes" prompts a reviewer must check, the
 * same summary `flaggedMedicalPrompts` already gives the trip roster
 * (`RosterSection.tsx`).
 */
function toSignedWaiverEntry(row: WaiverAuditJoinRow) {
  return {
    id: row.record.id,
    personId: row.record.personId,
    personName: row.personName,
    tripId: row.tripId,
    tripTitle: row.tripTitle,
    tripStartsAt: row.tripStartsAt,
    status: row.record.status,
    signedAt: row.record.signedAt,
    integrity: verifyWaiverIntegrity(row.record),
    flaggedPrompts:
      row.record.status === "medical_review" && row.record.medicalAnswers
        ? flaggedMedicalPrompts(row.record.medicalAnswers)
        : [],
  };
}

export type SignedWaiverEntry = ReturnType<typeof toSignedWaiverEntry>;

export type WaiverIntegrityAuditPage = {
  entries: SignedWaiverEntry[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * Signed evidence audit — the Signatures tab's data (`/shop/[shopSlug]/waivers/signatures`)
 * and its integrity check. Every row is shop-scoped by `shopId` (never trust a
 * route param for this — see the query's `where`), joins the trip the record
 * was issued against (null only for an imported record, which carries no
 * booking), and intentionally excludes bearer tokens and the raw medical
 * questionnaire (see `toSignedWaiverEntry`). One page at a time (ordered by
 * signature, then id for a stable tiebreak) so a shop with years of signed
 * waivers costs one page, not the whole table.
 *
 * Offset-paged, like the roster and the orders index. It was a forward-only
 * keyset cursor, which meant a staffer auditing deep history had "Show more"
 * and "Back to top" and nothing in between — no way back one page, and no way
 * to see how much evidence was left (ADR 20260803-one-pagination-model). This
 * is an audit trail, so "page 4 of 31" is not a nicety: it is how a reviewer
 * knows what they have and have not walked.
 *
 * The count carries the same `innerJoin people` the page does, so the two can
 * never disagree about how many rows exist.
 */
export async function listWaiverIntegrityAudit(
  db: DbExecutor,
  shopId: string,
  options: { page?: number; limit?: number } = {},
): Promise<WaiverIntegrityAuditPage> {
  const scope = and(
    eq(waiverRecords.shopId, shopId),
    inArray(waiverRecords.status, ["completed", "medical_review"]),
  );

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? WAIVER_INTEGRITY_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(waiverRecords)
        .innerJoin(people, eq(people.id, waiverRecords.personId))
        .where(scope);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({
          record: waiverRecords,
          personName: people.fullName,
          tripId: trips.id,
          tripTitle: trips.title,
          tripStartsAt: trips.startsAt,
        })
        .from(waiverRecords)
        .innerJoin(people, eq(people.id, waiverRecords.personId))
        .leftJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
        .leftJoin(trips, eq(trips.id, bookings.tripId))
        .where(scope)
        .orderBy(desc(waiverRecords.signedAt), desc(waiverRecords.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    entries: paged.rows.map(toSignedWaiverEntry),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/**
 * One signed record, by id, for the Signatures tab's "jump to a record"
 * entry point — the trip roster's "View signed record" link
 * (`RosterSection.tsx`), which a shop with a lot of signed history can
 * easily point past `listWaiverIntegrityAudit`'s current page. Shop-scoped
 * exactly like the audit: `shopId` gates the row, never a route param, so a
 * copied or guessed record id from another shop resolves to nothing rather
 * than that shop's medical-adjacent record.
 */
export async function getSignedWaiverRecordForShop(
  db: DbExecutor,
  shopId: string,
  recordId: string,
) {
  const [row] = await db
    .select({
      record: waiverRecords,
      personName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(waiverRecords)
    .innerJoin(people, eq(people.id, waiverRecords.personId))
    .leftJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(waiverRecords.id, recordId),
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
      ),
    )
    .limit(1);
  return row ? toSignedWaiverEntry(row) : null;
}

/**
 * Saves an edit as the next version. Versions increment per shop — history reads
 * v1 → v2 → v3 — and the most recent version is always what new links snapshot.
 * The previous version stays intact so a record already signed against it is never rewritten.
 */
export async function saveWaiverTemplate(db: AppDb, input: SaveWaiverTemplateInput) {
  return db.transaction(async (tx) => {
    // Locks the shop row before computing the next version — under READ
    // COMMITTED, two concurrent saves could otherwise both read the same max
    // version and both insert, colliding or creating an ambiguous legal
    // ordering (CR-015). Locking the shop row (rather than the existing
    // waiver_templates rows) also correctly serializes a shop's very first
    // template, when a row lock on the target table would have nothing yet
    // to hold. The unit suite runs on PGlite, which is single-connection and
    // cannot exhibit the race; the real-Postgres CI job is where a lock like
    // this one is provable (see `src/db/bookings.postgres.test.ts` for the
    // pattern — this particular lock does not yet have its own such test).
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, input.shopId)).for("update");
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
  // Carries the record (a real, once-valid link) so the page can still
  // identify the shop and its contact channels, and the record's own
  // `expiresAt` — a diver reading a dead link still deserves a name and a
  // way to reach someone, not a wall with nothing to click.
  | { state: "expired"; record: typeof waiverRecords.$inferSelect }
  | { state: "available"; record: typeof waiverRecords.$inferSelect }
  | { state: "completed"; record: typeof waiverRecords.$inferSelect };

/**
 * `bookingId` is nullable on the schema only for an imported record
 * (ADR 20260724-import-waiver-acceptance) — no completion link is ever issued
 * for one, so it can never be reached through a token. Every record a token
 * flow touches was born from `issueWaiverRequest` or `recordInPersonWaiver`,
 * both of which always set a real booking; this narrows that invariant for
 * token-reached callers rather than threading a null check through each one.
 */
export function requireTokenBookingId(record: { bookingId: string | null }): string {
  if (!record.bookingId) {
    throw new Error("Waiver record reached through a token has no bookingId");
  }
  return record.bookingId;
}

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
  if (record.expiresAt <= now) return { state: "expired", record };
  return { state: "available", record };
}

/**
 * The record behind a token that can no longer be signed but is still, provably,
 * the diver's own: pending and either past its expiry or superseded by a fresher
 * link. `getWaiverForToken` reports the first as `expired` and the second as
 * `unavailable`, and issuing a replacement supersedes the very record that asked
 * for it — so this is what keeps the same stale URL landing on the self-serve
 * "email me a fresh link" card on the second tap and every refresh after,
 * instead of a dead end that looks like the tap broke something.
 *
 * Deliberately narrow: never a live record and never a completed one, so this
 * can't become a second way to reach a signable link or to read signed evidence.
 * It returns the record for context only — the rescue flow issues its own fresh
 * token and hands it to the address on file, never back to the caller.
 */
export async function staleWaiverRecordForToken(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<typeof waiverRecords.$inferSelect | null> {
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(eq(waiverRecords.tokenHash, hashWaiverToken(token)))
    .limit(1);
  if (record?.status !== "pending") return null;
  if (!record.supersededAt && record.expiresAt > now) return null;
  return record;
}

/**
 * Does this booking already have a waiver link a diver could sign *right now*?
 *
 * The rescue flow's guard rail. Issuing supersedes every non-superseded record
 * for the booking, and a superseded record takes the diver's saved draft
 * (`draftMedicalAnswers`, emergency contact answers, half-filled medical
 * questionnaire) out of reach with it. So a stale token whose booking has since
 * been given a *fresher, still-live* link must never trigger another issue: the
 * bearer of the dead URL would be silently killing the link the diver is
 * actually working in, and wiping what they had typed.
 *
 * Deliberately a bare boolean — the caller learns only that a live link exists,
 * never its token, its address, or when it was issued.
 */
export async function hasLiveWaiverRequest(
  db: DbExecutor,
  bookingId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const [live] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.bookingId, bookingId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
        gt(waiverRecords.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(live);
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
  | {
      ok: false;
      reason: "unavailable" | "expired" | "invalid_signature" | "name_mismatch" | "invalid_medical";
    };

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

  // "Type your full name" is the signature. It accepted anything at least two
  // characters long, so a release could be executed under "asdf" and still read
  // as a signed waiver on the manifest. The typed name must plausibly be the
  // diver the record belongs to — `personNamesMatch` tolerates case, accents,
  // punctuation, word order and a middle initial (the noise that is *not* a
  // different person) and refuses anything that changes a name token.
  //
  // Refused *before* the record is touched, so a mismatch leaves the link
  // signable rather than burning it. A diver whose booking genuinely holds the
  // wrong name is directed to the shop, which can correct the record.
  const [signer] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, state.record.personId))
    .limit(1);
  if (!signer || !personNamesMatch(evidence.signerName, signer.fullName)) {
    return { ok: false, reason: "name_mismatch" };
  }

  // The form is conditional: closed boxes are not submitted, but every
  // applicable question must be answered before signed evidence is written.
  const medicalValidation = validateMedicalAnswers(input.medicalAnswers, { requireComplete: true });
  if (!medicalValidation.ok && input.medicalAnswers.questionnaireVersion !== 1) {
    return { ok: false, reason: "invalid_medical" };
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
    const [signedRecord] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, saved.id))
      .limit(1);
    if (signedRecord) {
      await db
        .update(waiverRecords)
        .set({
          integrityHash: computeWaiverIntegrityHash(signedRecord),
          integrityVersion: 1,
        })
        .where(eq(waiverRecords.id, signedRecord.id));
    }
    if (input.emergencyContact) {
      await saveEmergencyContact(db, requireTokenBookingId(state.record), input.emergencyContact);
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
 * The `people.id` of the staff member whose name goes on a paper release, or
 * `null` when whoever is claiming to attest it is not this shop's live staff
 * right now.
 *
 * This used to be a hand-rolled `person_roles` join here — `people.id` /
 * `people.shopId` / `person_roles.role` and nothing else. That catches what it
 * was written for (a diver, or somebody demoted out of every staff role) and
 * misses the two cases `loadActiveStaffRoles` exists for: a **deleted** person,
 * because `deleteDiver` sets `people.deleted_at` and leaves every role row
 * where it is, and a **disabled** account, because `setStaffAccountStatus`
 * revokes sign-in and leaves `person_roles` entirely intact — a suspended
 * employee keeps every role row they had. Both wrote a real, immutable
 * `waiver_records` row stamped `recorded_by_person_id`.
 *
 * That row is a signed medical and liability release, and the stamp is the
 * shop's answer to "who watched this diver sign?". A release attributed to
 * somebody the shop had already removed is a document that may have to stand up
 * outside the company, so the gate belongs in the writer rather than only in
 * the two server actions above it.
 *
 * `src/db/authz.ts` is the one place the rule lives; `loadActiveStaffRoles`
 * takes a `DbExecutor`, so it composes inside this transaction unchanged and
 * "who counts as live staff" widens once for the role gates and this writer
 * together. Same shape as `activeStaffRecorderId` in `src/db/manifests.ts`.
 */
async function activeStaffAttestorId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  // `loadActiveStaffRoles` has already proven the person is this shop's, alive,
  // and holds an active account; `isStaff` is the same `STAFF_ROLES` membership
  // the old join expressed as an `inArray`.
  return roles && isStaff(roles) ? personId : null;
}

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
    const attestedBy = await activeStaffAttestorId(tx, input.shopId, input.recordedByPersonId);
    if (!attestedBy) return { ok: false, reason: "staff_not_found" };

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
        recordedByPersonId: attestedBy,
        consentedAt: evidence.consentedAt,
        signedAt: evidence.signedAt,
        completedAt: now,
      })
      .returning();
    if (!record) throw new Error("recordInPersonWaiver: insert returned no row");
    await tx
      .update(waiverRecords)
      .set({ integrityHash: computeWaiverIntegrityHash(record), integrityVersion: 1 })
      .where(eq(waiverRecords.id, record.id));
    return { ok: true, recordId: record.id, alreadySigned: false };
  });
}

/**
 * Staff roster view: only the current record joins each active booking. The
 * single-trip form of `listTripsWaiverStatuses` below — one query, one rule,
 * so the two can never disagree about which record is current.
 */
export async function listTripWaiverStatuses(db: DbExecutor, shopId: string, tripId: string) {
  return listTripsWaiverStatuses(db, shopId, [tripId]);
}

/** Staff roster view: only the current record joins each active booking across multiple trips. */
export async function listTripsWaiverStatuses(db: DbExecutor, shopId: string, tripIds: string[]) {
  if (tripIds.length === 0) return [];
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
        inArray(bookings.tripId, tripIds),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt));
}
