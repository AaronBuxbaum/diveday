import type { RollCallRecord } from "./manifests";

const at = new Date("2026-08-15T12:00:00Z");
export const record = (state: RollCallRecord["state"], implied?: boolean): RollCallRecord => ({
  state,
  occurredAt: at,
  recordedByName: "Nora Quinn",
  ...(implied === undefined ? {} : { implied }),
});
