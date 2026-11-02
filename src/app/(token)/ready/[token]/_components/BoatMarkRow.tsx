import type { ReactNode } from "react";
import { SiteMark } from "@/components/illustration/SiteMark";

/**
 * **The boat's mark beside a line and its detail, on the sunken ground** — the
 * row `BoatStageLine` (where the boat is) draws on the diver's thread.
 *
 * The mark centres on the words whatever they wrap to (K-155), and an `action`
 * stands at the row's end. Presentational and hook-free.
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
