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
  // Toned text on the plain surface, not on a 10% tinted fill: the tint is the
  // documented sub-AA combination (`--warning` on its own fill reads 4.39:1
  // against AA's 4.5), and on `bg-surface` both tones clear the bar today
  // (warning 5.02:1, danger 6.47:1, measured) — the border keeps the chip a
  // chip.
  danger: "rounded-full border border-danger/40 bg-surface px-2.5 py-0.5 text-danger",
  warning: "rounded-full border border-warning/40 bg-surface px-2.5 py-0.5 text-warning",
  // No box at all: a neutral kind is a category, not an alert, and when every
  // row in the queue wears a bordered pill the pill grammar is spent — a badge
  // must mark the exceptional state, never the expected one (design principle
  // 9). The label keeps the same size, casing, and position, so the eye still
  // groups rows by kind; only the chrome is gone, which is what lets the
  // warning and danger chips above actually pop when one appears.
  neutral: "text-muted",
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
   *
   * Only a positive count renders. A chip *is* a kind that turned up, so a
   * "· 0" would contradict its own presence — `TomorrowGlance.byKind`
   * (src/lib/closeout.ts) tallies rows it actually has and so never emits one,
   * and a future caller that computes its counts differently gets a chip with
   * no tally rather than a chip arguing with itself.
   */
  count?: number;
  t: StaffTranslator;
}) {
  const { tone } = ACTION_KIND_META[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold tracking-wide uppercase ${CHIP_TONES[tone]}`}
    >
      {t(ACTION_KIND_KEYS[kind])}
      {count === undefined || !Number.isFinite(count) || count <= 0 ? null : (
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
