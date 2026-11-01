/**
 * Waivers: issuing a signing request — minting the bearer link for a booking
 * or a person. Imported through the `./waivers` barrel.
 */
import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type GuardianSigner, guardianSignatureMissing } from "@/lib/guardian";
import { isHeldToMedical } from "@/lib/participant-types";
import { openSecret, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { createWaiverToken, hashWaiverToken } from "@/lib/waiver-tokens";
import {
  bookingRecordLapsed,
  isCompletedWaiverCurrent,
  isUnclearedReferral,
  WAIVER_LINK_TTL_MS,
  waiverClockInstant,
} from "@/lib/waivers";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";
import { bookings, people, trips, waiverRecords } from "./schema";
import { getCurrentWaiverTemplate, shopTimezone } from "./waivers-templates";

export type IssueWaiverOutcome =
  | {
      ok: true;
      token: string;
      expiresAt: Date;
      recordId: string;
      /**
       * True when this handed back the link the diver already had rather than
       * minting one. Callers do not branch on it — a reused link and a fresh
       * one are the same URL to send — but it is what a test asserts, and what
       * tells you at a glance whether the deployment has a sealing key.
       */
      reused: boolean;
    }
  | {
      ok: false;
      reason:
        | "booking_not_found"
        | "booking_unavailable"
        | "person_not_found"
        | "template_not_found"
        | "already_completed"
        /**
         * The booking is a held seat (`identity_unconfirmed_at`): whoever holds
         * the link may not be the matched person, so none is issued until the
         * desk confirms who it is (issue #2125, mirroring `bookingSigner`).
         */
        | "identity_unconfirmed";
    };

/**
 * Issue the diver's waiver link — **the same one they already have**, whenever
 * they still have one that works.
 *
 * A shop reaches for this several times in one conversation: copy the link,
 * paste it into their own WhatsApp, then tap "Text waiver" to be sure. Every
 * one of those used to mint a fresh token and supersede the last, so the URL
 * just pasted was dead, and a diver part-way through signing online lost the
 * draft with it. So a live pending link is reused and its clock refreshed
 * (ADR 20260820-waiver-links-are-reused-not-reissued).
 *
 * "Live" is narrow, and each condition is load-bearing:
 *
 * - **Pending and not superseded.** A completed record has nothing to hand out.
 * - **Not expired.** The TTL stays a real bound; a link that already died is
 *   not resurrected, because reviving a months-old URL is exactly what a leak
 *   would want. A fresh one is minted instead.
 * - **Snapshotted from the template that is current now.** A shop that edited
 *   its release since has different terms, and letting the old link stand would
 *   collect a signature against wording the shop has withdrawn.
 * - **Openable.** Without `SECRET_ENCRYPTION_KEY` there is no readable copy of
 *   the token, so this falls back to minting — the behaviour it had before.
 *
 * When none of that holds it does what it always did: mint, supersede whatever
 * was pending, and insert. So an old token still cannot complete later; it just
 * stops being the *usual* outcome of asking twice.
 */
export async function issueWaiverRequest(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId?: string;
    personId?: string;
    expectedPersonId?: string;
    expectedTripId?: string;
    now?: Date;
  },
): Promise<IssueWaiverOutcome> {
  if (!input.bookingId && !input.personId) return { ok: false, reason: "person_not_found" };
  const token = createWaiverToken();
  const tokenHash = hashWaiverToken(token);
  const keyResult = secretKeyFromEnvironment();
  const sealingKey = keyResult.status === "ok" ? keyResult.key : null;

  const issue = async (tx: DbExecutor): Promise<IssueWaiverOutcome> => {
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    const candidate = input.bookingId
      ? await tx
          .select({
            id: bookings.id,
            personId: bookings.personId,
            tripId: bookings.tripId,
            minorDeclaredAt: bookings.minorDeclaredAt,
            tripStatus: trips.status,
            tripStartsAt: trips.startsAt,
            tripEndsAt: trips.endsAt,
            identityUnconfirmedAt: bookings.identityUnconfirmedAt,
            participantType: bookings.participantType,
          })
          .from(bookings)
          .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
          .where(
            and(
              eq(bookings.id, input.bookingId),
              eq(bookings.shopId, input.shopId),
              ne(bookings.status, "cancelled"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    if (input.bookingId && !candidate) return { ok: false, reason: "booking_not_found" };
    const personId = candidate?.personId ?? input.personId;
    if (!personId) return { ok: false, reason: "person_not_found" };
    const [lockedPerson] = await tx
      .select({
        id: people.id,
        dateOfBirth: people.dateOfBirth,
        anonymizedAt: people.anonymizedAt,
        mergedIntoPersonId: people.mergedIntoPersonId,
      })
      .from(people)
      // diveday:allow-deleted-people: an existing booking may belong to a removed person; erasure is refused below.
      .where(and(eq(people.id, personId), eq(people.shopId, input.shopId)))
      // diveday:allow-update-lock: issuance and signing use the same person-before-waiver order.
      .for("update")
      .limit(1);
    if (!lockedPerson || lockedPerson.anonymizedAt || lockedPerson.mergedIntoPersonId)
      return { ok: false, reason: "person_not_found" };
    let booking = candidate;
    if (candidate && input.bookingId) {
      const [lockedBooking] = await tx
        .select({
          id: bookings.id,
          personId: bookings.personId,
          tripId: bookings.tripId,
          minorDeclaredAt: bookings.minorDeclaredAt,
          tripStatus: trips.status,
          tripStartsAt: trips.startsAt,
          tripEndsAt: trips.endsAt,
          identityUnconfirmedAt: bookings.identityUnconfirmedAt,
          participantType: bookings.participantType,
        })
        .from(bookings)
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.shopId, input.shopId),
            ne(bookings.status, "cancelled"),
          ),
        )
        .for("update", { of: bookings })
        .limit(1);
      if (
        !lockedBooking ||
        lockedBooking.personId !== candidate.personId ||
        lockedBooking.tripId !== candidate.tripId ||
        lockedBooking.personId !== lockedPerson.id ||
        (input.expectedPersonId && lockedBooking.personId !== input.expectedPersonId) ||
        (input.expectedTripId && lockedBooking.tripId !== input.expectedTripId)
      ) {
        return { ok: false, reason: "booking_not_found" };
      }
      booking = lockedBooking;
      if (booking.tripStatus !== "scheduled") {
        return { ok: false, reason: "booking_unavailable" };
      }
      if (booking.identityUnconfirmedAt) return { ok: false, reason: "identity_unconfirmed" };
    }
    let dateOfBirth = lockedPerson.dateOfBirth;
    if (!booking) {
      const [person] = await tx
        .select({ id: people.id, dateOfBirth: people.dateOfBirth })
        .from(people)
        .where(
          and(eq(people.id, personId), eq(people.shopId, input.shopId), isNull(people.deletedAt)),
        )
        .limit(1);
      if (!person) return { ok: false, reason: "person_not_found" };
      dateOfBirth = person.dateOfBirth;
    }
    // A minor's solo signature is not a standing release (ADR
    // 20260907-guardian-co-signature): the tap that would have said "already
    // signed" instead supersedes it and mints a link that asks for both.
    const signer: GuardianSigner = {
      dateOfBirth,
      // The seat's booker's "Under 18", when a seat is what this link is for.
      minorDeclared: booking ? booking.minorDeclaredAt !== null : false,
      timezone: await shopTimezone(tx, input.shopId),
    };

    const current = await tx
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          booking
            ? eq(waiverRecords.bookingId, booking.id)
            : and(eq(waiverRecords.personId, personId), isNull(waiverRecords.bookingId)),
          isNull(waiverRecords.supersededAt),
        ),
      )
      .for("update");
    // An unanswered referral remains evidence after its waiver row is
    // superseded. Include the person's booking referrals only while that seat
    // still belongs to them; a link may have moved with the seat to someone
    // else. The person lock serializes referral signing and physician updates.
    const personReferrals = booking
      ? []
      : await tx
          .select({
            id: waiverRecords.id,
            status: waiverRecords.status,
            medicalClearedAt: waiverRecords.medicalClearedAt,
            signedAt: waiverRecords.signedAt,
            completedAt: waiverRecords.completedAt,
            createdAt: waiverRecords.createdAt,
          })
          .from(waiverRecords)
          .leftJoin(
            bookings,
            and(eq(bookings.id, waiverRecords.bookingId), eq(bookings.shopId, input.shopId)),
          )
          .where(
            and(
              eq(waiverRecords.shopId, input.shopId),
              eq(waiverRecords.personId, personId),
              eq(waiverRecords.status, "medical_review"),
              isNull(waiverRecords.medicalClearedAt),
              or(isNull(waiverRecords.bookingId), eq(bookings.personId, personId)),
            ),
          )
          .for("update", { of: waiverRecords });
    const personReferralIds = new Set(personReferrals.map((record) => record.id));
    const standingRecords = booking
      ? current
      : [...current.filter((record) => !personReferralIds.has(record.id)), ...personReferrals];
    // A row lock can wait past expiry or a concurrent signature. Re-read the
    // clock and terms only after every current record is locked.
    const now = input.now ?? nowDate();
    const expiresAt = new Date(now.getTime() + WAIVER_LINK_TTL_MS);
    const template = await getCurrentWaiverTemplate(tx, input.shopId);
    if (!template) return { ok: false, reason: "template_not_found" };
    // A signature that has lapsed (its year, its physician's year, or terms the
    // shop has since changed) stands for nothing: the seat reads
    // `waiver_lapsed`, and the fix is this fresh link. A hold or a refusal on
    // a seat in the water still stands; neither is a clean completion. A
    // rider's seat reads a held record as a signature (H-109), so it lapses
    // with the signature's own clock. **Measured where the roster measures it**
    // (`waiverClockInstant`, issue #2611): a release that runs out before the
    // trip is blocked there, so this door must take a fresh signature for it,
    // not answer "already completed".
    const heldToMedical = isHeldToMedical(booking?.participantType);
    const clockAt = booking
      ? waiverClockInstant({ now, startsAt: booking.tripStartsAt, endsAt: booking.tripEndsAt })
      : now;
    const lapsed = (record: (typeof current)[number]) =>
      bookingRecordLapsed(record, template.materialGeneration, clockAt, heldToMedical);
    const signatureTime = (
      record: Pick<(typeof current)[number], "signedAt" | "completedAt" | "createdAt">,
    ) => (record.signedAt ?? record.completedAt ?? record.createdAt).getTime();
    const cleanPersonReleases = current.filter(
      (record) =>
        isCompletedWaiverCurrent(record, template.materialGeneration, clockAt) &&
        !guardianSignatureMissing(record, signer),
    );
    // H-98's amendment allows a newer person-scoped clean release to stand over
    // an open referral. An open referral may belong to this person or one of
    // their current bookings; either makes an older clean person release
    // insufficient, so staff must be able to issue the next person-scoped link.
    // The booking-scoped branch above still refuses a booking whose own release
    // is held; that seat waits for a physician.
    const cleanPersonReleaseStands = cleanPersonReleases.some((clean) =>
      standingRecords.every(
        (record) => !isUnclearedReferral(record) || signatureTime(clean) > signatureTime(record),
      ),
    );
    const alreadyStanding = booking
      ? current.some(
          (record) =>
            record.status !== "pending" &&
            !lapsed(record) &&
            !guardianSignatureMissing(record, signer),
        )
      : cleanPersonReleaseStands;
    if (alreadyStanding) {
      return { ok: false, reason: "already_completed" };
    }

    // The link this diver already holds, if it is still one they can sign.
    const live = sealingKey
      ? current.find(
          (record) =>
            record.status === "pending" &&
            record.supersededAt === null &&
            record.expiresAt > now &&
            record.templateId === template.id &&
            record.templateVersion === template.version &&
            record.templateGeneration === template.materialGeneration &&
            record.tokenSealed,
        )
      : undefined;
    const reusedToken =
      live?.tokenSealed && sealingKey ? openSecret(live.tokenSealed, sealingKey) : null;
    if (live && reusedToken) {
      // Same record, same URL, fresh clock: whoever was just handed this link
      // gets the full window to sign, and the copy already pasted somewhere
      // keeps working. Nothing is superseded, so a half-filled draft on this
      // record survives being sent again.
      const refreshedExpiry = new Date(now.getTime() + WAIVER_LINK_TTL_MS);
      await tx
        .update(waiverRecords)
        .set({ expiresAt: refreshedExpiry })
        .where(eq(waiverRecords.id, live.id));
      return {
        ok: true,
        token: reusedToken,
        expiresAt: refreshedExpiry,
        recordId: live.id,
        reused: true,
      };
    }

    if (current.length > 0) {
      await tx
        .update(waiverRecords)
        // The old link is dead, so its openable copy has no reason to exist.
        .set({ supersededAt: now, tokenSealed: null })
        .where(
          and(
            eq(waiverRecords.shopId, input.shopId),
            booking
              ? eq(waiverRecords.bookingId, booking.id)
              : and(eq(waiverRecords.personId, personId), isNull(waiverRecords.bookingId)),
            isNull(waiverRecords.supersededAt),
          ),
        );
    }

    const [record] = await tx
      .insert(waiverRecords)
      .values({
        shopId: input.shopId,
        bookingId: booking?.id ?? null,
        personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateGeneration: template.materialGeneration,
        templateBody: template.body,
        tokenHash,
        tokenSealed: sealingKey ? sealSecret(token, sealingKey) : null,
        expiresAt,
      })
      .returning();
    if (!record) throw new Error("issueWaiverRequest: insert returned no row");
    return { ok: true, token, expiresAt, recordId: record.id, reused: false };
  };
  return isTransactionExecutor(db) ? issue(db) : db.transaction(issue);
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

/** The schedule-free counterpart used when a waiver belongs to the person. */
export async function hasLivePersonWaiverRequest(
  db: DbExecutor,
  shopId: string,
  personId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const [live] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        isNull(waiverRecords.bookingId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
        gt(waiverRecords.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(live);
}
