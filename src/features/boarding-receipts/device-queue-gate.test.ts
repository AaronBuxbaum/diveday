import { expect, it } from "vitest";
import { dockQueueEnabled } from "./device-queue-gate";

it("keeps the dock queue disabled until its safety contract is verified", () => {
  expect(dockQueueEnabled()).toBe(false);
});
