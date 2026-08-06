import type { StaffTranslator } from "@/i18n/staff-messages";
import { ACTION_KIND_KEYS } from "@/i18n/today-labels";
import { ACTION_KIND_META, type TodayAction } from "@/lib/today";

/**
 * The one chip that names a queue row's kind — worn by the Today queue and by
 * the close-out, which is Today's evening mirror and so must label the very
 * same rows the very same way.
 *
 * It lived twice, byte for byte, until this file: once in `TodayQueue.tsx` and
 * once in `close-out/page.tsx`. Two copies of a tone map is how a kind starts
 * reading warning on one surface and neutral on the other, which is exactly
 * the drift `ACTION_KIND_META` exists to prevent one level down.
 */
const CHIP_TONES = {
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  neutral: "border-border bg-surface-sunken text-muted",
} as const;

export function KindChip({
  kind,
  count,
  t,
}: {
  kind: TodayAction["kind"];
  /**
   * A tally to carry *inside* the chip ("WAIVER · 3"), for a summary that
   * counts kinds rather than listing rows. It has to live in the chip: set
   * beside one, a bare number is bound to its label by a gap alone, and at
   * 390px a wrapped row of them reads as a list of unrelated digits.
   */
  count?: number;
  t: StaffTranslator;
}) {
  const { tone } = ACTION_KIND_META[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase ${CHIP_TONES[tone]}`}
    >
      {t(ACTION_KIND_KEYS[kind])}
      {count === undefined ? null : (
        <>
          <span aria-hidden="true" className="font-normal opacity-60">
            ·
          </span>
          <span className="tabular-nums">{count}</span>
        </>
      )}
    </span>
  );
}
