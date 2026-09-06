import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ForgivingCopy } from "./ForgivingInput";

/**
 * Words for `ForgivingInput`, resolved server-side and passed down as plain
 * data — the house pattern for a staff Client Component (see
 * `paper-waiver-copy.ts` for why this lives beside, not inside, the component).
 *
 * `raw` is read with `st.raw` so the `{raw}` placeholder survives for the
 * component to fill on the client, where the typed text lives.
 */
export function forgivingCopy(t: StaffTranslator): ForgivingCopy {
  return { typedAs: t.raw("shared.forgiving.typedAs") };
}
