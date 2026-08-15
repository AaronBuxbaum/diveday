import type { OrderStatus } from "@/db/schema";
import type { StaffMessageKey } from "./staff-messages";

/**
 * **What an order's status is called, and what colour it wears.**
 *
 * The word already lived in one place. The colour did not: an order's status
 * rendered on four surfaces and each answered the tone question its own way —
 * the Orders index called `refunded` amber, the order detail page left it grey,
 * and the diver record's Payments list and per-booking money cell each
 * hand-rolled a flat grey pill that gave every status the same non-answer. One
 * refund therefore read three different ways depending on which screen a
 * staffer happened to be on, which is exactly the drift `readiness-labels.ts`
 * exists to prevent for "Blocked"/"Ready". Same fix, same shape: the code, the
 * word, and the tone resolve from one table.
 *
 * Keyed by the pg enum (`order_status`), so a status added to the column is a
 * compile error here until it has both.
 */
export const ORDER_STATUS_KEYS: Record<OrderStatus, StaffMessageKey> = {
  open: "divers.shared.orderStatus.open",
  paid: "divers.shared.orderStatus.paid",
  void: "divers.shared.orderStatus.void",
  uncollectible: "divers.shared.orderStatus.uncollectible",
  refunded: "divers.shared.orderStatus.refunded",
};

/**
 * The one tone each order status wears, everywhere it is shown.
 *
 * Read as what the word *means* to the person at the counter:
 *
 * - `open` — **primary.** An invoice is out and nobody has done anything
 *   wrong; it is the normal in-flight state of money, so it gets the app's
 *   "this is live" hue rather than a caution.
 * - `paid` — **success.** The settled, wanted end state.
 * - `void` — **neutral.** Cancelled before it ever counted. Nothing moved,
 *   nothing is owed, and colouring a non-event is how a quiet page learns to
 *   shout.
 * - `uncollectible` — **danger.** Stripe's word for money the shop billed and
 *   will not receive. It is the one status in this enum that is a loss, and
 *   until now it rendered the same grey as `void` on every surface — the
 *   written-off invoice and the one that never mattered looked identical.
 * - `refunded` — **warning.** Deliberate, not broken, but money went back out
 *   and a staffer reconciling the day needs to see it. This is the Orders
 *   index's existing call, kept because it was the considered one.
 *
 * **Not typed `BadgeTone`,** even though every value is one: `src/i18n` may not
 * import `src/components` (`pnpm check:architecture` — this layer is composed
 * *by* routes, never the reverse), the same constraint that has
 * `readinessStatusTone` naming its two tones as literals. `as const` is what
 * keeps that safe rather than merely quiet: the values stay literal types, so
 * every `<Badge tone={ORDER_STATUS_TONES[status]}>` in the app re-proves
 * assignability to `BadgeTone` at its own call site. A typo here is a compile
 * error on all four surfaces, not a silently-dropped class.
 *
 * Whether a given surface *shows* the badge is the surface's own call and
 * deliberately not encoded here — the Orders index renders nothing at all for
 * `paid`, because a success pill repeated down 45 of 50 rows is noise
 * pretending to be information (design principle 9). That is a caller's
 * `status === "paid" ? null : <Badge…>`, not a hole in this map: a hole would
 * quietly make `paid` grey on the two surfaces that do want to say it.
 */
export const ORDER_STATUS_TONES = {
  open: "primary",
  paid: "success",
  void: "neutral",
  uncollectible: "danger",
  refunded: "warning",
} as const satisfies Record<OrderStatus, string>;
