import type { BuddyAlert } from "@/lib/manifests";

/**
 * The buddy-team chip a roster row wears — quiet while the team's statuses
 * agree, loud when this person is back and someone on their team is not
 * (ADR 20260804-buddy-teams). Words carry the meaning; the tone only agrees
 * with them. Informs only — never a gate.
 *
 * One component for divers and crew, so a split team can never read one way on
 * a diver's row and another on the divemaster's.
 *
 * It takes **words, not a translator**: the same rule staff Client Components
 * follow (AGENTS.md). A resolver function is not serializable into the RSC
 * payload a client navigation streams, so passing `t` here rendered on first
 * load and then threw "Functions cannot be passed directly to Client
 * Components" the moment a form post redirected back — the page came back as
 * the error boundary with no clue why.
 */
export function BuddyTeamChip({
  label,
  alertText,
  alert,
}: {
  label: string | null;
  alertText: string | null;
  alert: BuddyAlert | null;
}) {
  if (!label) return null;
  return (
    <span
      className={
        alert === "separated_after_dive"
          ? "rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger"
          : alert === "separated_dock"
            ? "rounded-full bg-warning-tint px-3 py-1 text-sm font-semibold text-warning-strong"
            : "rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
      }
    >
      {alertText ? `${label} · ${alertText}` : label}
    </span>
  );
}
