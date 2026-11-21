import { and, eq, isNull } from "drizzle-orm";
import { readActiveStaffRoles } from "@/db/authz";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb, DbExecutor } from "@/db/client";
import { isLockWaitRefusal } from "@/db/lock-bounds";
import { queueMediaDeletion } from "@/db/media-deletions";
import {
  bookingCapabilities,
  bookings,
  people,
  privatePersonPhotoUploads,
  trips,
  userAccounts,
} from "@/db/schema";
import { lockSeatDeparture } from "@/db/seat-locks";
import { lockTripRevisionNotificationFence } from "@/db/trip-revision-notification-fence";
import { isStaff } from "@/lib/authz";
import { allocatePrivatePersonPhoto, uploadPrivatePersonPhoto } from "@/lib/storage";

type Actor =
  | { kind: "readiness"; token: string }
  | { kind: "staff"; shopId: string; personId: string; staffPersonId: string };
type Photo = { filename: string; contentType: string; bytes: ArrayBuffer } | null;
type Subject = { shopId: string; personId: string; bookingId?: string; tripId?: string };

async function identify(db: DbExecutor, actor: Actor): Promise<Subject | null> {
  if (actor.kind === "staff") return { shopId: actor.shopId, personId: actor.personId };
  const cap = await verifyBookingCapability(db, { token: actor.token, purpose: "readiness" });
  return cap?.delivered
    ? { shopId: cap.shopId, personId: cap.personId, bookingId: cap.bookingId, tripId: cap.tripId }
    : null;
}

/** Recheck identity under the same person/booking order used by erasure. */
async function lockedSubject(tx: DbExecutor, actor: Actor, subject: Subject): Promise<boolean> {
  if (actor.kind === "readiness") {
    if (!subject.tripId) return false;
    await lockTripRevisionNotificationFence(tx, subject.shopId, subject.tripId, "dispatch");
  }
  await lockBoardingCertificationEvidence(tx, subject.shopId, "rewrite");
  if (actor.kind === "readiness" && subject.tripId) {
    if (
      !subject.bookingId ||
      (await lockSeatDeparture(tx, subject.shopId, subject.bookingId)) !== subject.tripId
    )
      return false;
    const [trip] = await tx
      .select({ status: trips.status, deleted: trips.deletedAt })
      .from(trips)
      // diveday:allow-deleted-trips: deleted trips are checked under the lock and refused.
      .where(and(eq(trips.id, subject.tripId), eq(trips.shopId, subject.shopId)));
    if (!trip || trip.deleted || trip.status === "cancelled") return false;
  }
  if (actor.kind === "staff") {
    // Sign-in takes account then person. Staff removal takes the reverse order,
    // so never wait on the person while holding the account: return busy instead.
    await tx
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.personId, actor.staffPersonId))
      .for("share");
    await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.shopId, subject.shopId),
          eq(people.id, actor.staffPersonId),
          isNull(people.deletedAt),
        ),
      )
      .for("share", { noWait: true });
  }
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, subject.shopId),
        eq(people.id, subject.personId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    // diveday:allow-update-lock: serialize publication with erasure and identity changes.
    .for("update");
  if (!person) return false;
  if (actor.kind === "staff") {
    const roles = await readActiveStaffRoles(tx, subject.shopId, actor.staffPersonId);
    return Boolean(roles && isStaff(roles));
  }
  if (!subject.bookingId) return false;
  const [booking] = await tx
    .select({
      personId: bookings.personId,
      held: bookings.identityUnconfirmedAt,
      tripId: bookings.tripId,
    })
    .from(bookings)
    .where(and(eq(bookings.id, subject.bookingId), eq(bookings.shopId, subject.shopId)))
    .for("update");
  if (
    !booking ||
    booking.personId !== subject.personId ||
    booking.tripId !== subject.tripId ||
    booking.held
  )
    return false;
  // A concurrent revocation must serialize with the final capability check.
  await tx
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, subject.shopId),
        eq(bookingCapabilities.bookingId, subject.bookingId),
      ),
    )
    .for("update");
  const current = await verifyBookingCapability(tx, { token: actor.token, purpose: "readiness" });
  return Boolean(
    current?.delivered &&
      current.personId === subject.personId &&
      current.shopId === subject.shopId &&
      current.bookingId === subject.bookingId,
  );
}

/** Stage before PUT, then publish and retire the previous key in one transaction. */
export async function changePrivatePersonPhoto(
  db: AppDb,
  input: { actor: Actor; file: Photo },
): Promise<"saved" | "invalid" | "failed"> {
  try {
    return await changePhoto(db, input);
  } catch (error) {
    if (isLockWaitRefusal(error)) return "failed";
    throw error;
  }
}

async function changePhoto(
  db: AppDb,
  input: { actor: Actor; file: Photo },
): Promise<"saved" | "invalid" | "failed"> {
  const subject = await identify(db, input.actor);
  if (!subject) return "invalid";
  let url: string | null = null;
  if (input.file) {
    const allocation = allocatePrivatePersonPhoto();
    if (!allocation) return "failed";
    url = allocation.url;
    const staged = await db.transaction(async (tx) => {
      if (!(await lockedSubject(tx, input.actor, subject))) return false;
      await tx.insert(privatePersonPhotoUploads).values({
        url: allocation.url,
        shopId: subject.shopId,
        personId: subject.personId,
        state: "staged",
      });
      return true;
    });
    if (!staged) return "invalid";
    const upload = await uploadPrivatePersonPhoto(url, input.file);
    // A successful response or a rejection before PUT proves no write remains in flight.
    // Ambiguous provider outcomes stay unfinished for continued reconciliation.
    if (upload !== "uncertain") {
      await db
        .update(privatePersonPhotoUploads)
        .set({ putFinished: true })
        .where(eq(privatePersonPhotoUploads.url, url));
    }
    if (upload !== "stored") return "failed";
  }
  return db.transaction(async (tx) => {
    if (!(await lockedSubject(tx, input.actor, subject))) return "invalid";
    if (url) {
      const [staged] = await tx
        .update(privatePersonPhotoUploads)
        .set({ state: "active" })
        .where(
          and(
            eq(privatePersonPhotoUploads.url, url),
            eq(privatePersonPhotoUploads.shopId, subject.shopId),
            eq(privatePersonPhotoUploads.state, "staged"),
          ),
        )
        .returning({ url: privatePersonPhotoUploads.url });
      if (!staged) return "failed";
    }
    const [person] = await tx
      .select({ privatePath: people.diverPhotoPath })
      .from(people)
      // diveday:allow-deleted-people: the live subject was checked and locked by lockedSubject above.
      .where(and(eq(people.shopId, subject.shopId), eq(people.id, subject.personId)));
    if (!person) throw new Error("person disappeared under lock");
    if (person.privatePath && person.privatePath !== url) {
      await tx
        .update(privatePersonPhotoUploads)
        .set({ state: "retired" })
        .where(
          and(
            eq(privatePersonPhotoUploads.shopId, subject.shopId),
            eq(privatePersonPhotoUploads.url, person.privatePath),
          ),
        );
      await queueMediaDeletion(tx, {
        shopId: subject.shopId,
        personId: subject.personId,
        kind: "staff_profile",
        url: person.privatePath,
        purgeVersions: true,
      });
    }
    await tx
      .update(people)
      .set({
        diverPhotoPath: url,
        diverPhotoSuppressed: !url,
      })
      .where(and(eq(people.shopId, subject.shopId), eq(people.id, subject.personId)));
    return "saved";
  });
}
