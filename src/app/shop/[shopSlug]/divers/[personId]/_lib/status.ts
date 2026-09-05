import type { StaffMessageKey } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { BLOCKER_CATEGORY, type ReadinessBlocker, type ReadinessResult } from "@/lib/readiness";
import { hasSailed } from "@/lib/trips";
import {
  cardsNeedingLookCount,
  type DiverProfile,
  firstOpenOrderId,
  unpaidBookingCount,
} from "../_components/shared";

/**
 * **What is still open about this diver, and the one fix for each** — the
 * status ledger the record now leads with (ADR 20260827-people-not-lists,
 * decision 1: "this diver, ready or not — and the one fix if not").
 *
 * The design's load-bearing silence is here rather than in the component:
 * **an empty array means the section renders nothing at all.** Not "All
 * clear", not an empty card with a heading — nothing. A record that opens on
 * a green box saying a diver is fine has spent the reader's first glance
 * telling them there is no work, which is the fact a blank space already
 * carries (`status.test.ts` pins it, and so does `DiverStatusLedger`).
 *
 * **No second detector.** Everything trip-bound comes from the readiness
 * engine the Today queue and the manifest already read
 * (`calculateReadiness` via `src/db/readiness.ts`), handed in by the caller;
 * this module only decides which of those blockers surface here, in what
 * order, and what the fix beside each one is. The record-level facts — a card
 * nobody has looked at, a release never signed, money outstanding, no
 * emergency contact — come straight off the profile, and each is the same
 * condition an existing surface already counts (`cardsNeedingLookCount`,
 * `shopWaiverStatus`, `unpaidBookingCount`, the roster's `missing_contact`
 * filter).
 *
 * **Rows carry codes, never sentences.** A `DiverStatusRow` names a message
 * key or hands back the `ReadinessBlocker` itself; the surface picks the
 * words (`readinessBlockerText`). That is AGENTS.md's rule for `src/lib`, and
 * it applies here for the same reason — the record and any later adopter must
 * not be able to word one condition two ways.
 *
 * The SPEC proposed `sentenceKey: string` for every row. It is a two-armed
 * union instead, because a readiness blocker's words are already single-sourced
 * in `src/i18n/readiness-labels.ts` and flattening them to a key here would
 * either duplicate that table or lose the blocker's `params` (the required
 * level, the specialty, the minimum age). Interface names in a SPEC are
 * proposals; the behaviour below is what the tests pin.
 */

/** Which part of the record a row is about — and the word the row leads with. */
export type DiverStatusKind = "certification" | "waiver" | "payment" | "contact";

/** Where the row's one fix takes the reader. Resolved to a control by the surface. */
export type DiverStatusTarget = "verify" | "send_waiver" | "collect" | "edit_contact";

export type DiverStatusRow = {
  kind: DiverStatusKind;
  /** `danger` when it stops this diver boarding a departure they are on; `warning` otherwise. */
  tone: "danger" | "warning";
  /**
   * The row's one sentence, as a code. Either a readiness blocker (worded by
   * `readinessBlockerText`) or a key from `staff/divers.json` with its values.
   */
  sentence:
    | { blocker: ReadinessBlocker }
    | { key: StaffMessageKey; values?: Record<string, string | number> };
  /**
   * The one fix, beside the row.
   *
   * **Optional, deliberately.** A medical hold has no act the shop can take
   * from this page — the release is held until a doctor writes back — and
   * offering "Send the waiver" beside it would send a link that
   * `issueWaiverRequest` refuses and tell a staffer to do something that
   * cannot help. A row with no fix is honest; an invented one is not.
   */
  action?: { labelKey: StaffMessageKey; target: DiverStatusTarget };
  /** The departure this row is bound to, for the quiet "on Thu, Aug 27" line. */
  tripContext?: { tripId: string; startsAt: Date };
  /** The order a `collect` fix opens, when one has been raised. */
  orderId?: string;
};

type BookingEntry = DiverProfile["bookings"][number];

/** Is this seat still ahead of the diver? */
export function bookingIsAhead(entry: BookingEntry, now: Date): boolean {
  return (
    entry.trip.status === "scheduled" &&
    entry.booking.status !== "cancelled" &&
    !hasSailed(entry.trip.startsAt, now)
  );
}

/**
 * The departure the record's status is measured against: the soonest one this
 * diver is still on. Readiness is per-trip, so a record-level page has to pick
 * one, and the next boat is the one somebody is about to be standing beside.
 */
export function nextBookingAhead(diver: DiverProfile, now: Date = nowDate()): BookingEntry | null {
  return (
    [...diver.bookings]
      .filter((entry) => bookingIsAhead(entry, now))
      .sort((a, b) => a.trip.startsAt.getTime() - b.trip.startsAt.getTime())[0] ?? null
  );
}

/**
 * "On file" needs both a name and a number (glossary — Emergency contact), so
 * a hole in either is the row. Exactly the condition the roster's
 * `missing_contact` view narrows by (`src/db/divers.ts`), asked of one person.
 */
function missingEmergencyContact(diver: DiverProfile): boolean {
  return !diver.person.emergencyContactName?.trim() || !diver.person.emergencyContactPhone?.trim();
}

/** The first blocker in a family, or nothing. One row per kind — a ledger, not a log. */
function firstBlockerIn(
  readiness: ReadinessResult | null,
  category: "waiver" | "certification" | "payment",
): ReadinessBlocker | null {
  if (readiness?.status !== "blocked") return null;
  return readiness.blockers.find((blocker) => BLOCKER_CATEGORY[blocker.code] === category) ?? null;
}

/**
 * **The open items on a diver's record, worst first.**
 *
 * At most one row per kind: the ledger answers "what is open", and a diver
 * with three pending cards has one job, not three. Danger rows (a departure
 * this diver is on will not let them board) sort above warnings (real work,
 * nobody waiting on a boat).
 *
 * `readiness` is the result for {@link nextBookingAhead}, or null when the
 * diver is on no departure at all — in which case every row here is
 * record-level and none of them is danger, because nothing is being blocked.
 */
export function buildDiverStatus(
  diver: DiverProfile,
  readiness: ReadinessResult | null,
  options: { now?: Date } = {},
): DiverStatusRow[] {
  const now = options.now ?? nowDate();
  const next = nextBookingAhead(diver, now);
  const tripContext = next ? { tripId: next.trip.id, startsAt: next.trip.startsAt } : undefined;
  const rows: DiverStatusRow[] = [];

  // --- Waiver.
  const waiverBlocker = firstBlockerIn(readiness, "waiver");
  if (waiverBlocker) {
    rows.push({
      kind: "waiver",
      tone: "danger",
      sentence: { blocker: waiverBlocker },
      // A held medical is the one waiver state nobody here can move; see the
      // `action` docstring above.
      action:
        waiverBlocker.code === "medical_review" || waiverBlocker.code === "medical_not_cleared"
          ? undefined
          : { labelKey: "divers.status.acts.sendWaiver", target: "send_waiver" },
      tripContext,
    });
  } else if (diver.waiver.state === "medical_review") {
    rows.push({ kind: "waiver", tone: "danger", sentence: { key: "divers.status.waiverHeld" } });
  } else if (diver.waiver.state === "medical_not_cleared") {
    // Its own branch above the generic one, and with no act, for the same
    // reason the hold has none: "Send the waiver" is the one offer that is
    // actively wrong here. Another link lets a diver whose physician said no
    // answer the questionnaire again and board on a fresh clean signature
    // (issue #1282's hole), which is the last thing this row should invite.
    rows.push({
      kind: "waiver",
      tone: "danger",
      sentence: { key: "divers.status.waiverNotCleared" },
    });
  } else if (diver.waiver.state !== "current") {
    rows.push({
      kind: "waiver",
      tone: "warning",
      sentence: {
        key:
          diver.waiver.state === "expired"
            ? "divers.status.waiverExpired"
            : "divers.status.waiverMissing",
      },
      action: { labelKey: "divers.status.acts.sendWaiver", target: "send_waiver" },
    });
  }

  // --- Certifications.
  const certBlocker = firstBlockerIn(readiness, "certification");
  const awaiting = cardsNeedingLookCount(diver);
  if (certBlocker) {
    rows.push({
      kind: "certification",
      tone: "danger",
      sentence: { blocker: certBlocker },
      action: { labelKey: "divers.status.acts.verify", target: "verify" },
      tripContext,
    });
  } else if (awaiting > 0) {
    rows.push({
      kind: "certification",
      tone: "warning",
      sentence: { key: "divers.status.cardsWaiting", values: { count: awaiting } },
      action: { labelKey: "divers.status.acts.verify", target: "verify" },
    });
  }

  // --- Money.
  const paymentBlocker = firstBlockerIn(readiness, "payment");
  const owed = unpaidBookingCount(diver);
  const orderId = owed > 0 ? firstOpenOrderId(diver) : undefined;
  if (paymentBlocker) {
    rows.push({
      kind: "payment",
      tone: "danger",
      sentence: { blocker: paymentBlocker },
      action: { labelKey: "divers.status.acts.collect", target: "collect" },
      tripContext,
      orderId,
    });
  } else if (owed > 0) {
    rows.push({
      kind: "payment",
      tone: "warning",
      sentence: { key: "divers.status.openBalance", values: { count: owed } },
      action: { labelKey: "divers.status.acts.collect", target: "collect" },
      orderId,
    });
  }

  // --- Who to call. Never a blocker (readiness does not gate on it), always
  // worth doing before a boat leaves with this diver on it.
  if (missingEmergencyContact(diver)) {
    rows.push({
      kind: "contact",
      tone: "warning",
      sentence: { key: "divers.status.noEmergencyContact" },
      action: { labelKey: "divers.status.acts.editContact", target: "edit_contact" },
    });
  }

  return rows.sort((a, b) => Number(b.tone === "danger") - Number(a.tone === "danger"));
}
