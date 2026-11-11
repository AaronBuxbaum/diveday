import { expect, it } from "vitest";
import { redactEvent } from "./observability";

it("scrubs stack URL credentials before Sentry derives its issue culprit", () => {
  const frame = Object.freeze({
    filename: "https://dive.day/reset-password/fake-token",
    abs_path: "https://dive.day/email-sign-in/fake-token",
    lineno: 42,
  });
  const event = redactEvent({
    type: undefined,
    exception: { values: [{ value: "Readable error", stacktrace: { frames: [frame] } }] },
  });
  expect(event.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({
    filename: "/reset-password/[token]",
    abs_path: "/email-sign-in/[token]",
    lineno: 42,
  });
  expect(frame.filename).toContain("fake-token");
  expect(event.exception?.values?.[0].value).toBe("Readable error");
});
