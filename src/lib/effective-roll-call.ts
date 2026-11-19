import {
  foldRollCallEvidence,
  type RollCallEvidence,
  type RollCallProjection,
} from "./roll-call-causality";

/** The persisted projection is not the same thing as the original statement. */
export type EffectiveRollCallStatement = RollCallEvidence & {
  subject: string;
  checkpoint: string;
  day: number;
  statementStatus?: RollCallEvidence["status"] | null;
};

export function effectiveRollCallKey(subject: string, checkpoint: string, day: number): string {
  return JSON.stringify([subject, checkpoint, day]);
}

/** Remove ineligible nodes before the fold, so their edges cannot supersede eligible evidence. */
export function foldEffectiveRollCallEvidence<
  T extends RollCallEvidence & { statementStatus?: RollCallEvidence["status"] | null },
>(
  rows: readonly T[],
  checkpoint: string,
  isEligible: (row: T) => boolean,
  frontierEligible?: ReadonlySet<string>,
): RollCallProjection {
  const evidence = rows
    .filter(isEligible)
    .map((row) => ({ ...row, status: row.statementStatus ?? row.status }));
  return foldRollCallEvidence(evidence, checkpoint, frontierEligible);
}

/**
 * Project a batch after removing ineligible statements and their causal edges.
 * The caller supplies eligibility: this function does not authenticate a capture.
 * Unknown-day withdrawals remain candidates for every day, as in the existing fold.
 */
export function projectEffectiveRollCalls<T extends EffectiveRollCallStatement>(
  rows: readonly T[],
  isEligible: (row: T) => boolean,
): Map<string, RollCallProjection> {
  const scopes = new Map<string, T[]>();
  for (const row of rows) {
    if (!isEligible(row)) continue;
    const key = JSON.stringify([row.subject, row.checkpoint]);
    const scope = scopes.get(key) ?? [];
    scope.push(row);
    scopes.set(key, scope);
  }
  const result = new Map<string, RollCallProjection>();
  for (const scope of scopes.values()) {
    const first = scope[0];
    if (!first) continue;
    const evidence = scope.map((row) => ({ ...row, status: row.statementStatus ?? row.status }));
    const unknownWithdrawals = evidence.filter((row) => row.day < 0 && row.status === "cleared");
    for (const day of new Set(evidence.map((row) => row.day))) {
      const eligible = new Set(
        [...evidence.filter((row) => row.day === day), ...unknownWithdrawals].map((row) => row.id),
      );
      result.set(
        effectiveRollCallKey(first.subject, first.checkpoint, day),
        foldEffectiveRollCallEvidence(evidence, first.checkpoint, () => true, eligible),
      );
    }
  }
  return result;
}
