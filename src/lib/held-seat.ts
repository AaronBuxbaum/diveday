import type { TripManifest } from "./manifests";

/**
 * **A held seat on the boat manifest** (issue #1690, H-79).
 *
 * A booking attached to an existing diver on a guess (H-13: a reused email
 * under another name, or a name tapped off the counter's "is this the same
 * diver?" prompt) carries `identity_unconfirmed` until a staffer confirms it.
 * Everything the manifest knows about the matched person is then a fact about
 * *somebody*, not provably about whoever walks up the gangway. The Divers tab
 * already withholds those particulars (`showsPersonDetail` in
 * `RosterSection.tsx`); this is the same rule for the three carriers of the
 * manifest: the screen, the printed sheet and the copy a crew phone saves.
 *
 * It is a safety argument as much as a privacy one. The emergency contact on a
 * held row is the matched person's next of kin, so if the person aboard goes
 * missing, the number on the sheet reaches the wrong family and the crew
 * believes it has a contact when it has none. Paper is where that is hardest to
 * correct, so the printed sheet withholds as well, and says so in words.
 *
 * What stays is the **seat**: its name, its readiness word, its roll-call
 * mark, its check-in and desk release, its buddy team, its pickup, and the
 * blockers that belong to the seat (the identity question and its payment).
 * A seat that cannot board has to appear and has to say so. What waits is the
 * **person**: contact, age and minor status, birthday, welcome word, rental
 * sizes and nitrox, the medical mark, the depth advisory measured against the
 * matched person's cards, and every blocker measured against their record.
 *
 * **Imports nothing at runtime**, deliberately: `offline-manifests.ts` uses
 * this and is compiled into the service worker, where a value import of
 * `readiness.ts` drags `node:crypto` in and fails the worker build (see the
 * header of `roll-call.ts`). So the seat's own blocker codes are spelled here,
 * and `held-seat.test.ts` holds them equal to `heldSeatBlockers` in
 * `identity-match.ts`, which reads the same answer off `BLOCKER_CATEGORY`.
 */

/**
 * The blockers that belong to the seat rather than to the matched person: the
 * identity question, the seat's payment, and the two about the system rather
 * than anybody's record (`readiness_unavailable`, `requirements_not_configured`),
 * which no answer to the identity question would clear.
 */
export const SEAT_OWN_BLOCKER_CODES: ReadonlySet<string> = new Set([
  "identity_unconfirmed",
  "payment_due",
  "payment_refunded",
  "readiness_unavailable",
  "requirements_not_configured",
]);

type BlockerLike = { code: string };

/**
 * Whether this row is a held seat. Either signal is enough: the readiness
 * blocker (what the roster reads) or the identity claim the db assembly sets
 * from `bookings.identity_unconfirmed_at`. Fails toward withholding.
 */
export function isHeldSeat(diver: {
  identityClaim?: unknown;
  readiness?: { blockers: ReadonlyArray<BlockerLike> };
}): boolean {
  return (
    diver.identityClaim !== undefined ||
    (diver.readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed") ?? false)
  );
}

/**
 * The name a seat goes by: the name it was booked under while the seat is
 * held, the person's own name otherwise. Settled once where a reader joins
 * the booking to its person (the manifest assembly, every buddy-team read and
 * the trail's frozen `memberNames`), so no later surface — the not-back-aboard
 * alarm, a teammate label, the incident export — can print the matched
 * person's name for somebody who may not be them.
 */
export function seatName(
  fullName: string,
  seat: { identityUnconfirmedAt: Date | null; identityBookedAs: string | null },
): string {
  if (!seat.identityUnconfirmedAt) return fullName;
  return seat.identityBookedAs?.trim() || fullName;
}

type ManifestDiver = TripManifest["divers"][number];

/**
 * The row as a held seat may show it: unchanged for a seat that is not held,
 * and for a held one the matched person's particulars cleared and
 * `identityWithheld` set, so a surface can say why the facts are missing
 * rather than print "Not on file" (a wrong fact, not an absent one).
 *
 * Readiness keeps its status: the seat is still blocked on everything it was
 * blocked on. Only the sentences measured against the matched person go, and
 * **their going is said** (dive-domain review 2026-10-06):
 * `moreHoldsBehindConfirmation` is set whenever any of them was dropped, with
 * no hint of which, so a medical hold behind the identity question still
 * reaches the rail as "other holds may still apply" rather than vanishing.
 *
 * The name is the one the seat was **booked under** when the claim carries
 * it: that is who will walk up the gangway, and the matched person's name on
 * a crew phone or a printed sheet is itself a fact about somebody else.
 * `minor` is null, not false: unknown, never "an adult".
 *
 * A held seat is **blocked, whatever readiness said**: the status is forced
 * and the identity blocker is put back if the readiness read left it out, so
 * a claim with no matching blocker can never read as ready to board. Safe to
 * apply twice: a row already withheld comes back unchanged, so the page can
 * settle its rows once at the top and a component can still guard its own.
 */
export function withholdHeldSeatParticulars(diver: ManifestDiver): ManifestDiver {
  if (diver.identityWithheld || !isHeldSeat(diver)) return diver;
  const own = diver.readiness.blockers.filter((blocker) =>
    SEAT_OWN_BLOCKER_CODES.has(blocker.code),
  );
  const kept = own.some((blocker) => blocker.code === "identity_unconfirmed")
    ? own
    : [{ code: "identity_unconfirmed" as const }, ...own];
  const dropped = diver.readiness.blockers.length - own.length;
  return {
    ...diver,
    fullName: diver.identityClaim?.bookedAs?.trim() || diver.fullName,
    identityWithheld: true,
    moreHoldsBehindConfirmation: dropped > 0,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    rentalFit: { state: "not_recorded" },
    nitroxRequested: false,
    age: null,
    minor: null,
    birthday: null,
    welcomeCue: null,
    depthAdvisory: undefined,
    medicalWaiver: null,
    readiness: { status: "blocked", blockers: kept },
  };
}
