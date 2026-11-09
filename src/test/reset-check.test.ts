import { expect, it } from "vitest";
import { assertDemoReset } from "../../e2e/reset-check";

it("rejects an unsuccessful initial reset with status and phase but no response body", () => {
  expect(() =>
    assertDemoReset({ ok: () => false, status: () => 500 }, "initial reset worker 2"),
  ).toThrow("initial reset worker 2: POST /api/test/reset returned 500");
});
it("accepts a successful reset", () => {
  expect(() => assertDemoReset({ ok: () => true, status: () => 200 }, "reset")).not.toThrow();
});
