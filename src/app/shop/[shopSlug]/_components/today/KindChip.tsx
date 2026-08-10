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
/**
 * Only the exceptional tones wear a pill.
 *
 * Danger and warning stay exactly as they were: toned text on the plain
 * surface, not on a 10% tinted fill — the tint is the documented sub-AA
 * combination (`--warning` on its own fill reads 4.39:1 against AA's 4.5), and
 * on `bg-surface` both tones clear the bar today (warning 5.02:1, danger
 * 6.47:1, measured) — the border keeps the chip a chip.
 *
 * Neutral is now quiet caps text with no border and no fill. Once the queue's
 * bordered "Open …" buttons dissolved into whole-row links, the chip became
 * the loudest mark on every row, and seven of the twenty-three kinds are
 * neutral (`ACTION_KIND_META`) — so a staffer scanning for the red
 * `MISSING DIVER` had to read past a column of grey pills shaped exactly like
 * it. That is the "a badge on every row means nothing on any row" failure
 * design/principles.md #9 names, and the fix is to spend chip-weight only
 * where the row is exceptional.
 *
 * The words do not change, so state is still never carried by color alone.
 * `text-muted` clears AA against every surface these two consumers put it on —
 * `bg-background` 5.01:1, `bg-surface` 5.27:1, `bg-surface-sunken` 4.58:1 in
 * light; 7.29 / 6.54 / 7.63:1 in dark (measured, not eyeballed) — which is why
 * dropping the sunken fill is safe: the chip now sits on the row's own
 * background, including the `hover:bg-surface` tint.
 */
const CHIP_TONES = {
  danger: "rounded-full border border-danger/40 bg-surface px-2.5 py-0.5 tracking-wide text-danger",
  warning:
    "rounded-full border border-warning/40 bg-surface px-2.5 py-0.5 tracking-wide text-warning",
  // Wider tracking than the pills carry, matching the calendar block's caps
  // (`src/app/s/[shopSlug]/page.tsx`): it is the app's established register for
  // a label that names something without competing with it.
  neutral: "tracking-[0.18em] text-muted",
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
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase ${CHIP_TONES[tone]}`}
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
