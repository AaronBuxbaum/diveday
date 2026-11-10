// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => sdk);
vi.mock("@/features/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("./_fonts/fonts", () => ({ fontVariables: "" }));

import GlobalError from "./global-error";

it("initializes the real deferred reporter before sending a root error before idle", async () => {
  Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: vi.fn() });
  const error = new Error("root crash");
  render(<GlobalError error={error} reset={vi.fn()} />);
  await waitFor(() => expect(sdk.captureException).toHaveBeenCalledWith(error));
  expect(sdk.init).toHaveBeenCalledOnce();
  expect(sdk.init.mock.invocationCallOrder[0]).toBeLessThan(
    sdk.captureException.mock.invocationCallOrder[0],
  );
});
