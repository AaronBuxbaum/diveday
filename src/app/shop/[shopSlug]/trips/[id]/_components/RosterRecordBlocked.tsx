import { StatusMarkColumn } from "@/components/ui/StatusMark";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint } from "@/lib/roll-call";
import type { CountedAboardBlocked } from "@/lib/roll-call-readiness";

/**
 * **A record row's one line about a seat counted aboard while blocked** (issue
 * #2414): "Counted aboard (After dive 1) while blocked: No certification on
 * file." In danger text, on the same column as a live row's reasons, and with
 * no control: a record never asks for action, and what stood in the way is
 * what the rail saw, not what readiness says today.
 */
export function RosterRecordBlocked({
  t,
  blocked,
}: {
  t: StaffTranslator;
  blocked: CountedAboardBlocked;
}) {
  return (
    <ul className="-mt-1 grid gap-1 pb-2 text-sm">
      <li className="flex items-baseline gap-2 text-danger">
        <StatusMarkColumn variant="danger" />
        <span className="min-w-0">
          {t("trips.roster.recordCountedBlocked", {
            checkpoint: rollCallCheckpointText(t, blocked.checkpoint as RollCallCheckpoint),
            reasons: blocked.blockers.map((blocker) => readinessBlockerText(t, blocker)).join(" "),
          })}
        </span>
      </li>
    </ul>
  );
}
