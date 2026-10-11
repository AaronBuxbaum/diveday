/**
 * Waivers: reading signed records back — the integrity audit, one signed
 * record for staff, a diver's own copy, and every signed release a person
 * holds. Imported through the `./waivers` barrel.
 */
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { guardianSignatureOf } from "@/lib/guardian";
import { flaggedMedicalPrompts } from "@/lib/medical";
import { isUuid } from "@/lib/uuid";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import type { DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import { bookings, people, trips, waiverRecords } from "./schema";
import { WAIVER_STATE_COLUMNS, type WaiverStateRecord } from "./waiver-record-columns";

/** How many audit rows the Signatures tab shows per page. */
export const WAIVER_INTEGRITY_PAGE_SIZE = PAGE_SIZE.list;

/** The join shape both `listWaiverIntegrityAudit` and `getSignedWaiverRecordForShop` select. */
type WaiverAuditJoinRow = {
  record: typeof waiverRecords.$inferSelect;
  personName: string;
  tripId: string | null;
  tripTitle: string | null;
  tripStartsAt: Date | null;
};

/**
 * Shared row shaping for the signature log: never the bearer token, never
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
    /**
     * Which release this signature was given against — the fact that decides
     * whether it still counts (`isCompletedWaiverCurrent`), and the one thing
     * a reviewer reading the log back cannot infer from anything else on the
     * row. Already on `row.record`, so it costs no column and no join.
     */
    templateVersion: row.record.templateVersion,
    /** Who co-signed a minor's release, or null (ADR 20260907-guardian-co-signature). */
    guardian: guardianSignatureOf(row.record),
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
 * Signed evidence audit — the signature log's data (`/shop/[shopSlug]/waivers`)
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
        .leftJoin(
          bookings,
          and(eq(bookings.id, waiverRecords.bookingId), eq(bookings.shopId, waiverRecords.shopId)),
        )
        .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, waiverRecords.shopId)))
        .where(scope)
        .orderBy(desc(waiverRecords.signedAt), asc(people.fullName), desc(waiverRecords.id))
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
    .innerJoin(
      people,
      and(eq(people.id, waiverRecords.personId), eq(people.shopId, waiverRecords.shopId)),
    )
    .leftJoin(
      bookings,
      and(eq(bookings.id, waiverRecords.bookingId), eq(bookings.shopId, waiverRecords.shopId)),
    )
    .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, waiverRecords.shopId)))
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
 * **One signed release, whole** — what "View signed record" opens (Aaron,
 * 2026-10-06: "you actually can't even view the signed record!").
 *
 * The signature log's row says a release exists; this is the release: what
 * the diver signed, how, when, the questionnaire they answered, and what a
 * physician said about it. Scoped by shop *and* by the diver whose record the
 * URL names, so a record id from one diver's page never opens another's.
 * Superseded records are included on purpose — a refusal retired off its seat
 * is still evidence — and pending ones are not: an unsigned link has nothing
 * to show and its token must never reach a staff page.
 */
export async function getSignedWaiverForDiver(
  db: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    recordId: string;
    /** `canReadMedicalAnswers`: every answer and the physician's name, or only the prompts that flagged. */
    readsMedicalAnswers: boolean;
  },
) {
  if (!isUuid(input.recordId) || !isUuid(input.personId)) return null;
  const [row] = await db
    .select({
      record: waiverRecords,
      personName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
    })
    .from(waiverRecords)
    .innerJoin(
      people,
      and(eq(people.id, waiverRecords.personId), eq(people.shopId, waiverRecords.shopId)),
    )
    .leftJoin(
      bookings,
      and(eq(bookings.id, waiverRecords.bookingId), eq(bookings.shopId, waiverRecords.shopId)),
    )
    .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, waiverRecords.shopId)))
    .where(
      and(
        eq(waiverRecords.id, input.recordId),
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.personId),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { record } = row;
  // A release on a seat still held over who is in it (H-13) may not be this
  // diver's: what it says about them waits for that confirmation, as it does
  // on the roster.
  const identityHeld = Boolean(row.identityUnconfirmedAt);
  const answers = identityHeld ? null : record.medicalAnswers;
  return {
    id: record.id,
    personId: record.personId,
    personName: row.personName,
    identityHeld,
    trip:
      row.tripId && row.tripTitle
        ? { id: row.tripId, title: row.tripTitle, startsAt: row.tripStartsAt }
        : null,
    status: record.status,
    signedAt: record.signedAt ?? record.completedAt,
    signedName: identityHeld ? null : record.signedName,
    signatureMethod: record.signatureMethod,
    templateTitle: record.templateTitle,
    templateVersion: record.templateVersion,
    templateBody: record.templateBody,
    guardian: identityHeld ? null : guardianSignatureOf(record),
    integrity: verifyWaiverIntegrity(record),
    /**
     * When the co-signing guardian's address was erased on request (H-103) —
     * the note a redacted release carries, so its blank address reads as the
     * shop's act rather than as a field nobody filled.
     */
    guardianEmailErasedAt: record.guardianEmailErasedAt,
    /** Which seal is on it — the redaction note is only true under version 4. */
    integrityVersion: record.integrityVersion,
    /** Every answer, for an owner or manager; null for anyone else. */
    medicalAnswers: input.readsMedicalAnswers ? answers : null,
    /** What the roster shows every staff role: the prompts that flagged, on a record held for them. */
    flaggedPrompts:
      answers && record.status === "medical_review" ? flaggedMedicalPrompts(answers) : [],
    medicalClearedAt: record.medicalClearedAt,
    medicalClearanceDeclinedAt: record.medicalClearanceDeclinedAt,
    medicalClearanceEvaluatedOn: record.medicalClearanceEvaluatedOn,
    medicalClearancePhysicianName: input.readsMedicalAnswers
      ? record.medicalClearancePhysicianName
      : null,
    medicalClearanceDocumentOnFile: Boolean(record.medicalClearanceDocumentUrl),
    supersededAt: record.supersededAt,
  };
}

export type SignedWaiverForDiver = NonNullable<Awaited<ReturnType<typeof getSignedWaiverForDiver>>>;

/**
 * Every *signed* release on file for a set of divers at a shop, grouped by
 * person — the evidence the sign-once rule draws on. Includes both `completed`
 * and `medical_review` records (superseded ones excluded, but for a retired
 * refusal — see the query): the caller needs the
 * medical holds too, so a stale clean signature can never carry a diver past a
 * newer, unresolved medical review. Currency (template version, age) is decided
 * per booking by `effectiveWaiverForBooking`.
 */
export async function listSignedWaiversByPerson(
  db: DbExecutor,
  shopId: string,
  personIds: string[],
): Promise<Map<string, WaiverStateRecord[]>> {
  const byPerson = new Map<string, WaiverStateRecord[]>();
  if (personIds.length === 0) return byPerson;
  const rows = await db
    .select({ record: WAIVER_STATE_COLUMNS })
    .from(waiverRecords)
    .leftJoin(
      bookings,
      and(eq(bookings.id, waiverRecords.bookingId), eq(bookings.shopId, waiverRecords.shopId)),
    )
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.personId, personIds),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
        // A retired refusal stays in the evidence: superseded so its seat can
        // carry a fresh release, it still outranks every signature older than
        // it (`isStandingRefusal`), or sign-once would fall back past it.
        or(
          isNull(waiverRecords.supersededAt),
          and(
            eq(waiverRecords.status, "medical_review"),
            isNotNull(waiverRecords.medicalClearanceDeclinedAt),
            isNull(waiverRecords.medicalClearedAt),
          ),
        ),
        // **A clean release signed on a held seat does not carry** (#2082).
        // Until staff confirm who took the seat, whoever held its link may
        // not be this diver, and their "no" to every medical question must
        // not clear the diver's other bookings or outrank a real hold. The
        // seat's own release still reaches it as `bookingWaiver`. A medical
        // hold signed there still carries: failing toward the hold is safe.
        or(
          isNull(waiverRecords.bookingId),
          isNull(bookings.identityUnconfirmedAt),
          eq(waiverRecords.status, "medical_review"),
        ),
      ),
    )
    .then((joined) => joined.map((row) => row.record));
  for (const row of rows) {
    const list = byPerson.get(row.personId) ?? [];
    list.push(row);
    byPerson.set(row.personId, list);
  }
  return byPerson;
}
