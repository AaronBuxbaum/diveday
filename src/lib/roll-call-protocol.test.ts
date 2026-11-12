import { expect, it } from "vitest";
import {
  ROLL_CALL_CAUSAL_HEADERS,
  ROLL_CALL_CAUSAL_PROTOCOL_HEADER,
  supportsCausalRollCall,
} from "./roll-call-protocol";

it("requires an explicit current causal capability independently of queue record format", () => {
  expect(supportsCausalRollCall(undefined)).toBe(false);
  expect(supportsCausalRollCall(new Request("http://localhost"))).toBe(false);
  expect(
    supportsCausalRollCall(
      new Request("http://localhost", { headers: { [ROLL_CALL_CAUSAL_PROTOCOL_HEADER]: "old" } }),
    ),
  ).toBe(false);
  expect(
    supportsCausalRollCall(new Request("http://localhost", { headers: ROLL_CALL_CAUSAL_HEADERS })),
  ).toBe(true);
});
