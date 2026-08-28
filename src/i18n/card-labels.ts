import type {
  CardDisplayStatus,
  CertificationCardRowState,
  HeldCardDisplayStatus,
} from "@/lib/certification-cards";
import type { StaffMessageKey } from "./staff-messages";

/**
 * **What a certification card's state is called, and what it wears.**
 *
 * The codes are `src/lib/certification-cards.ts`'s; the words are here, the
 * same split `readiness.ts`/`readiness-labels.ts` uses and for the same reason:
 * the domain layer returns codes, never sentences, and one table of words is
 * what stops "pending" reading two ways on two screens.
 *
 * **Tones are not typed `BadgeTone`,** even though every value is one:
 * `src/i18n` may not import `src/components` (`pnpm check:architecture`). The
 * literal return types and `as const` are what keep that safe rather than
 * merely quiet — every `<Badge tone={…}>` call site re-proves assignability.
 */

/**
 * Staff-facing card labels. A card is "certified" once staff confirm it (they
 * look the number up with the issuing agency and click Mark certified); the
 * stored status is still `verified`, which is what readiness reads.
 */
export const CARD_STATUS_KEYS: Record<CardDisplayStatus, StaffMessageKey> = {
  pending: "divers.shared.cardStatus.pending",
  verified: "divers.shared.cardStatus.verified",
};

export function cardStatusTone(status: CardDisplayStatus): "success" | "warning" {
  return status === "verified" ? "success" : "warning";
}

export const HELD_CARD_STATUS_KEYS: Record<HeldCardDisplayStatus, StaffMessageKey> = {
  ...CARD_STATUS_KEYS,
  confirm_to_clear: "divers.shared.cardStatus.confirmToClear",
};

export function heldCardStatusTone(status: HeldCardDisplayStatus): "success" | "warning" {
  // Warning, not success: the card is on file, and the gate is not open yet.
  return status === "confirm_to_clear" ? "warning" : cardStatusTone(status);
}

/**
 * **The badge a shared card row wears, complete** (ADR
 * 20260827-people-not-lists, decision 6). One table, four entries, and the
 * first of them is the point:
 *
 * - `verified` → **nothing.** A card the shop has certified is the expected
 *   state, and a badge marks the exceptional one
 *   (20260827-clearwater-surface-language, decision 3). A green pill down
 *   every row of the file is noise pretending to be information. The `null` is
 *   the design's silence, and `rows.test.tsx` pins it.
 * - `pending` → **warning**, with the tone glyph and the word: somebody has to
 *   look this card up.
 * - `self_declared` → **warning**, worded as the diver's own claim. Same
 *   strength as pending because it is the same job, and the word says who said
 *   it.
 * - `imported_unconfirmed` → **neutral**, worded "certified · confirm to
 *   clear". A prompt, not a warning: the card came across already checked by
 *   the shop's own previous system, and one tap opens the gate. The *blocker*
 *   derived from the same fact — the record's status ledger, the home's
 *   station, readiness itself — carries the blocker's own tone, which is the
 *   tone escalation this ADR states out loud: one fact, two contexts. The
 *   gate has never been the badge's job (`src/lib/readiness.ts` decides who
 *   boards), and the word carries the state whatever the tone.
 */
export const CERTIFICATION_ROW_STATE_BADGE: Record<
  CertificationCardRowState,
  { key: StaffMessageKey; tone: "warning" | "neutral" } | null
> = {
  verified: null,
  pending: { key: "divers.shared.cardStatus.pending", tone: "warning" },
  self_declared: { key: "divers.certifications.selfDeclaredLabel", tone: "warning" },
  imported_unconfirmed: { key: "divers.shared.cardStatus.confirmToClear", tone: "neutral" },
};
