import { expect, it } from "vitest";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import type { DbExecutor } from "./client";
import { offlineFrontierMatches } from "./offline-roll-call-frontier";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const root = clientRollCallEvidenceId(uuid(1));
const input = {
  shopId: uuid(2),
  tripId: uuid(3),
  checkpoint: "departure",
  meetingDay: 0,
  subject: { bookingId: uuid(4) },
  snapshotId: uuid(5),
  captured: [root],
};
function executor(rows: unknown[]): DbExecutor {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  } as unknown as DbExecutor;
}
function row(n: number, observed: string[]) {
  return {
    id: uuid(1000 + n),
    clientEventId: uuid(n),
    observedEvidenceIds: observed,
    captureContext: { offlineSnapshotId: input.snapshotId, offlineWitnessFrontier: [root] },
  };
}
it("checks converging same-copy ancestry once and reaches the signed baseline", async () => {
  const rows = [row(10, [root]), row(11, [root])];
  for (let n = 12; n < 52; n++)
    rows.push(
      row(n, [clientRollCallEvidenceId(uuid(n - 1)), clientRollCallEvidenceId(uuid(n - 2))]),
    );
  const last = clientRollCallEvidenceId(uuid(51));
  expect(
    await offlineFrontierMatches(executor(rows), { ...input, current: [last], observed: [last] }),
  ).toBe(true);
});
it("refuses a cyclic or disconnected ancestry", async () => {
  const first = clientRollCallEvidenceId(uuid(10));
  const second = clientRollCallEvidenceId(uuid(11));
  expect(
    await offlineFrontierMatches(executor([row(10, [second]), row(11, [first])]), {
      ...input,
      current: [first],
      observed: [first],
    }),
  ).toBe(false);
  expect(
    await offlineFrontierMatches(executor([row(10, [])]), {
      ...input,
      current: [first],
      observed: [first],
    }),
  ).toBe(false);
});
