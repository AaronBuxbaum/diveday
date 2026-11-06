/**
 * Waivers: opening a release to sign, for a seat or a person. The record
 * carries no link and no clock: a seat's release is signed on its holder's
 * thread link or a counter link, and a release with no seat on a counter link
 * or a release link (`src/lib/capabilities.ts`, issue #3983). Imported through
 * the `./waivers` barrel.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type GuardianSigner, guardianSignatureMissing } from "@/lib/guardian";
import { isHeldToMedical } from "@/lib/participant-types";
import {
  bookingRecordLapsed,
  isCompletedWaiverCurrent,
  isUnclearedReferral,
  waiverClockInstant,
} from "@/lib/waivers";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { mintCapability } from "./capabilities";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";
import { bookings, capabilities, people, trips, waiverRecords } from "./schema";
import { seatNotCancelled } from "./trips-queries";
import {
  WAIVER_BOARDING_COLUMNS,
  withTrustedClearance,
  withVerifiedClearance,
} from "./waiver-record-columns";
import { threadWaiverKey, type WaiverKey, waiverLinkDoor } from "./waivers-completion";
import { getCurrentWaiverTemplate, shopTimezone } from "./waivers-templates";

export type IssueWaiverRefusal = {
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
 * A release opened for signing: the record, and whether it was the one already
 * waiting (`reused`), kept with its draft, rather than a fresh one.
 */
export type OpenedRelease = { ok: true; recordId: string; reused: boolean };

export type IssueWaiverOutcome =
  | {
      ok: true;
      recordId: string;
      /** The release was the one already waiting, kept with its draft. */
      reused: boolean;
      /**
       * A server-side key that signs this release, never a URL: the seat's
       * thread key, or for a release with no seat a release link's key.
       */
      key: WaiverKey;
    }
  | IssueWaiverRefusal;

type IssueWaiverInput = {
  shopId: string;
  bookingId?: string;
  personId?: string;
  expectedPersonId?: string;
  expectedTripId?: string;
  now?: Date;
};

/**
 * **Open a release and hand back a key that signs it**, for the fact layer
 * (`src/db/facts`) and the tests: the diver's side of a release, without a
 * link anyone was sent. A seat's key is its thread key; a release with no seat
 * gets a fresh release link (`release_link`), whose key it returns, so the
 * signature spends it as an emailed link's would. Nothing here returns a token,
 * and no staff surface calls it: a staffer's link is the counter link
 * (`issueAndDeliverPersonWaiver`).
 */
export async function issueWaiverRequest(
  db: DbExecutor,
  input: IssueWaiverInput,
): Promise<IssueWaiverOutcome> {
  const opened = await openRelease(db, input);
  if (!opened.ok) return opened;
  if (input.bookingId) {
    const key = await threadWaiverKey(db, { shopId: input.shopId, bookingId: input.bookingId });
    if (key?.recordId !== opened.recordId) return { ok: false, reason: "booking_not_found" };
    return { ...opened, key };
  }
  const link = await mintCapability(db, {
    purpose: "release_link",
    shopId: input.shopId,
    subjectId: opened.recordId,
    now: input.now,
  });
  const door = await waiverLinkDoor(db, link.token, { now: input.now });
  if (door?.door !== "release") return { ok: false, reason: "person_not_found" };
  return { ...opened, key: door.key };
}

export type OpenThreadWaiverOutcome = { ok: true; recordId: string } | IssueWaiverRefusal;

/**
 * **Open the seat's release in the diver's own thread** (issue #2743).
 *
 * The caller has verified the readiness capability for `bookingId`; the
 * release is then signed on that same link (`/ready/<token>/waiver`), so no
 * waiver link is handed to anyone.
 *
 * A live record on the current terms is kept, with its draft; anything else
 * is superseded by a fresh one (`openRelease`).
 *
 * The booking confirmation opens it too (`openJoinSignStep`), for the
 * readiness link it carries: the mail's Sign step is that link's
 * `/ready/<token>/waiver`, never a waiver link.
 */
export async function openWaiverInThread(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    /** The seat's holder and departure the caller observed; a move between reads refuses. */
    expectedPersonId: string;
    expectedTripId: string;
    now?: Date;
  },
): Promise<OpenThreadWaiverOutcome> {
  const outcome = await openRelease(db, input);
  return outcome.ok ? { ok: true, recordId: outcome.recordId } : outcome;
}

/**
 * **Open a release with no seat** (issue #3983): the record a counter link or
 * a release link will name. The caller mints the link; the record carries
 * none, and no clock of its own.
 */
export async function openPersonRelease(
  db: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<OpenedRelease | IssueWaiverRefusal> {
  return openRelease(db, { ...input, expectedPersonId: input.personId });
}

/**
 * **The one rule for whether there is a release to sign, and on which terms.**
 *
 * - A signature that still stands refuses (`already_completed`).
 * - A pending, unsuperseded record on the shop's current terms is kept, with
 *   its draft: asking twice never costs a diver what they typed. A record
 *   carries no expiry of its own; the link that opens it does.
 * - Anything else is superseded and a fresh record opened on the current
 *   terms, so a signature is never collected against wording the shop has
 *   withdrawn.
 */
async function openRelease(
  db: DbExecutor,
  input: IssueWaiverInput,
): Promise<OpenedRelease | IssueWaiverRefusal> {
  if (!input.bookingId && !input.personId) return { ok: false, reason: "person_not_found" };
  const recordId = randomUUID();

  const issue = async (tx: DbExecutor): Promise<OpenedRelease | IssueWaiverRefusal> => {
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
              seatNotCancelled,
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
            seatNotCancelled,
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
      .for("update")
      // A clearance counts only while its seal verifies (issue #3998).
      .then((rows) => rows.map(withVerifiedClearance));
    // An unanswered referral remains evidence after its waiver row is
    // superseded. Include the person's booking referrals only while that seat
    // still belongs to them; a link may have moved with the seat to someone
    // else. The person lock serializes referral signing and physician updates.
    const personReferrals = booking
      ? []
      : await tx
          .select(WAIVER_BOARDING_COLUMNS)
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
              or(isNull(waiverRecords.bookingId), eq(bookings.personId, personId)),
            ),
          )
          .for("update", { of: waiverRecords })
          // Uncleared once the seal is read: a stamp whose seal does not verify is no answer
          // (issue #3998).
          .then((rows) =>
            rows.map(withTrustedClearance).filter((record) => record.medicalClearedAt === null),
          );
    const personReferralIds = new Set(personReferrals.map((record) => record.id));
    const standingRecords = booking
      ? current
      : [...current.filter((record) => !personReferralIds.has(record.id)), ...personReferrals];
    // A row lock can wait past expiry or a concurrent signature. Re-read the
    // clock and terms only after every current record is locked.
    const now = input.now ?? nowDate();
    const template = await getCurrentWaiverTemplate(tx, input.shopId);
    if (!template) return { ok: false, reason: "template_not_found" };
    // A signature that has lapsed (its year, its physician's year, or terms the
    // shop has since changed) stands for nothing: the seat reads
    // `waiver_lapsed`, and the fix is this fresh link. A hold or a refusal on
    // a seat in the water still stands; neither is a clean completion. A
    // rider's seat reads a held record as a signature (H-20261009-rider-snorkeler-medical), so it lapses
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
        !guardianSignatureMissing(record, signer) &&
        // A release changed after signing stands for nothing (issue #3885):
        // the fix is the fresh signature this link asks for.
        record.integrityValid !== false,
    );
    // H-20261007-after-physician-says-no's amendment allows a newer person-scoped clean release to stand over
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
            !guardianSignatureMissing(record, signer) &&
            record.integrityValid !== false,
        )
      : cleanPersonReleaseStands;
    if (alreadyStanding) {
      return { ok: false, reason: "already_completed" };
    }

    // The release this diver already has open, kept with its draft, while it
    // is still on the shop's current terms.
    const live = current.find(
      (record) =>
        record.status === "pending" &&
        record.supersededAt === null &&
        record.templateId === template.id &&
        record.templateVersion === template.version &&
        record.templateGeneration === template.materialGeneration,
    );
    if (live) return { ok: true, recordId: live.id, reused: true };

    if (current.length > 0) {
      await tx
        .update(waiverRecords)
        .set({ supersededAt: now })
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
        id: recordId,
        shopId: input.shopId,
        bookingId: booking?.id ?? null,
        personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateGeneration: template.materialGeneration,
        templateBody: template.body,
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("openRelease: insert returned no row");
    return { ok: true, recordId: record.id, reused: false };
  };
  return isTransactionExecutor(db) ? issue(db) : db.transaction(issue);
}

/**
 * Does this person already hold a live release link to a release with no
 * seat: unspent, unrevoked and unexpired, on a release still waiting for its
 * signature? A counter link does not count: it stands beside a mailed one
 * (issue #4008), so a fresh mail never revokes it. The rescue flow's guard: the bearer
 * of a dead URL learns only that a live link exists, never its token, address
 * or age, and drives no delivery on it.
 */
export async function hasLivePersonWaiverRequest(
  db: DbExecutor,
  shopId: string,
  personId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const [live] = await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .innerJoin(
      waiverRecords,
      and(
        eq(waiverRecords.id, capabilities.waiverRecordId),
        eq(waiverRecords.shopId, capabilities.shopId),
      ),
    )
    .where(
      and(
        eq(capabilities.purpose, "release_link"),
        eq(capabilities.shopId, shopId),
        isNull(capabilities.usedAt),
        isNull(capabilities.revokedAt),
        gt(capabilities.expiresAt, now),
        eq(waiverRecords.personId, personId),
        isNull(waiverRecords.bookingId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .limit(1);
  return Boolean(live);
}
