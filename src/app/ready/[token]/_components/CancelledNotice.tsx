import { type DoorGlyphId, EntryDone } from "@/components/account/EntryShell";
import type { DiverTranslator } from "@/i18n/messages";
import { verifiedCancelNotice } from "./cancel-notices";

/**
 * A terminal outcome for this link — a dead token, or a booking that was
 * cancelled underneath the diver. `EntryDone` is the app's one warm terminal
 * pattern (docs/design/principles.md #4) and the same shape `claim/[token]`
 * already gives a dead bearer link; this page used to spell a `rounded-2xl`
 * card of its own instead, which is how three token pages ended up with three
 * different boxes saying the same kind of thing.
 *
 * The mark is drawn and decorative (ADR 20260827-first-light, decision 2).
 * `expired` is the app-wide "this link has run out" clock; a cancelled booking
 * gets the `cancelled` calendar instead, because the link is fine and telling
 * that diver to ask for a fresh one would send them the wrong way.
 */
function Notice({
  title,
  text,
  glyph = "expired",
}: {
  title: string;
  text: string;
  glyph?: DoorGlyphId;
}) {
  return <EntryDone glyph={glyph} title={title} text={text} />;
}

/** The "This booking was cancelled" notice, with refund copy derived from the booking's current payment status. */
export function cancelledNotice(
  paymentStatus: string | null | undefined,
  tripTitle: string,
  shopName: string,
  t: DiverTranslator,
) {
  const refundKey = verifiedCancelNotice(paymentStatus);
  return (
    <Notice
      glyph="cancelled"
      title={t("ready.cancelledHeading")}
      text={
        refundKey
          ? t(refundKey)
          : t("ready.cancelledSeatReleased", { trip: tripTitle, shop: shopName })
      }
    />
  );
}
