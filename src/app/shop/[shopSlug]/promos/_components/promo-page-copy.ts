import type { BadgeTone } from "@/components/ui/badge";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { PromoLedgerGroup } from "@/lib/promo-codes";

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
export const NOTICES: Record<
  string,
  { tone: "success" | "danger" | "warning"; key: StaffMessageKey }
> = {
  created: { tone: "success", key: "promos.notice.created" },
  enabled: { tone: "success", key: "promos.notice.enabled" },
  disabled: { tone: "success", key: "promos.notice.disabled" },
  deleted: { tone: "success", key: "promos.notice.deleted" },
  invalid: { tone: "danger", key: "promos.notice.invalid" },
  "invalid-code": { tone: "danger", key: "promos.notice.invalidCode" },
  "invalid-discount": { tone: "danger", key: "promos.notice.invalidDiscount" },
  "invalid-window": { tone: "danger", key: "promos.notice.invalidWindow" },
  duplicate: { tone: "danger", key: "promos.notice.duplicate" },
  "not-connected": { tone: "warning", key: "promos.notice.notConnected" },
  "stripe-failed": { tone: "danger", key: "promos.notice.stripeFailed" },
  "not-authorized": { tone: "danger", key: "promos.notice.notAuthorized" },
  restored: { tone: "success", key: "promos.notice.restored" },
  "restore-failed": { tone: "danger", key: "promos.notice.restoreFailed" },
};

/**
 * The refusals that belong on one box in the new-code form, not in a banner
 * above it. `Field`'s `error` renders each under its own control and wires the
 * `aria-invalid`/`aria-describedby` pair; `FieldErrorFocus` then puts the
 * cursor on the first one, so "that discount is out of range" arrives *on the
 * discount box* rather than four fields above it.
 */
export const NOTICE_FIELD: Record<string, "code" | "discount" | "startsAt"> = {
  "invalid-code": "code",
  duplicate: "code",
  "invalid-discount": "discount",
  "invalid-window": "startsAt",
};

/**
 * The rest of what the new-code form can say. Everything not listed here or in
 * `NOTICE_FIELD` is about the *list* below the form — a code enabled, deleted,
 * restored — and keeps the page-level banner.
 */
export const CREATE_FORM_NOTICES = new Set([
  "created",
  "invalid",
  "not-connected",
  "stripe-failed",
]);

export const SCOPE_KEYS: Record<"all" | "trips" | "courses", StaffMessageKey> = {
  all: "promos.scope.all",
  trips: "promos.scope.trips",
  courses: "promos.scope.courses",
};

/** The shelf words, one per group `promoLedgerGroup` can return. */
export const GROUP_KEYS: Record<PromoLedgerGroup, StaffMessageKey> = {
  live: "promos.group.live",
  scheduled: "promos.group.scheduled",
  ended: "promos.group.ended",
};

/**
 * The badge a code wears, or nothing.
 *
 * Only the exceptional statuses are here (ADR
 * 20260827-clearwater-surface-language, decision 3 — a badge marks the
 * exception, never the expected). Whether a code is live, waiting to start or
 * over is its *window*, which the shelf it sits on already says once for the
 * whole run; "Live" and "Not live right now" were pills repeating a fact the
 * group header now owns, and both keys retired with them.
 *
 * All three keep the neutral tone the shipped page gave them. Slice 9g is a
 * recomposition and not a re-toning: a `failed` code arguably wants danger
 * ink, but that is a decision about what a broken code *is*, and it belongs
 * with whoever makes it deliberately rather than arriving as a side effect of
 * moving the window word to a heading. The row's own acts — Try again, Delete
 * — sit beside every one of these and say what to do about it.
 */
export const STATUS_BADGES: Record<string, { tone: BadgeTone; key: StaffMessageKey }> = {
  failed: { tone: "neutral", key: "promos.status.failed" },
  pending: { tone: "neutral", key: "promos.status.pending" },
  disabled: { tone: "neutral", key: "promos.status.disabled" },
};
