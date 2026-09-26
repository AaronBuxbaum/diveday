import type { ReactNode } from "react";
import { SiteMark } from "@/components/illustration/SiteMark";

/**
 * **The boat's mark beside a line and its detail, on the sunken ground** — the
 * one row `BoatStageLine` (where the boat is) and `FollowShareRow` (share that
 * with someone waiting) both draw, one under the other on the diver's thread.
 *
 * It was two hand copies of one class string that differed in one word: the
 * stage line's `items-start` hung its mark 20px above the card's centre at
 * 390, where the share row's was centred (K-155). One drawing, so the two
 * cannot fork again. The mark centres on the words whatever they wrap to, and
 * an `action` stands at the row's end.
 *
 * Presentational and hook-free, so the server-rendered stage line and the
 * client share row can both render it.
 */
export function BoatMarkRow({
  line,
  detail,
  action,
}: {
  /** The row's one line, in body weight. */
  line: ReactNode;
  /** The quiet line under it. */
  detail: ReactNode;
  /** A control at the row's end, when the row does something. */
  action?: ReactNode;
}) {
  return (
    <div className="mt-6 flex items-center gap-3 rounded-panel bg-surface-sunken p-4">
      <SiteMark mark="boat" size="sm" ground="surface" coral={false} />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{line}</p>
        <p className="mt-0.5 text-sm text-muted tabular-nums">{detail}</p>
      </div>
      {action}
    </div>
  );
}
