// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("./_fonts/fonts", () => ({ fontVariables: "" }));
vi.mock("./sentry-client", () => {
  return { browserSentry: { captureException: telemetry.capture } };
});

import GlobalError from "./global-error";

afterEach(() => {
  cleanup();
  telemetry.capture.mockReset();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("root error fallback", () => {
  it("reports the error without showing details, and retry resets", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("private failure"), { digest: "private-digest" });
    render(<GlobalError error={error} reset={reset} />);
    await waitFor(() => expect(telemetry.capture).toHaveBeenCalledWith(error));
    expect(screen.queryByText(/private failure|private-digest/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /email/i })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:/),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("keeps the fallback usable if capture throws", async () => {
    telemetry.capture.mockImplementation(() => {
      throw new Error("capture failed");
    });
    const reset = vi.fn();
    render(<GlobalError error={new Error("crash")} reset={reset} />);
    await waitFor(() => expect(telemetry.capture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("records the first stale-deploy reload attempt", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const set = vi.spyOn(Storage.prototype, "setItem");
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GlobalError error={new Error("Loading chunk 123 failed.")} reset={vi.fn()} />);
    expect(set).toHaveBeenCalledWith("diveday:stale-deploy-reloaded", "1000000");
  });

  it("does not reload a stale deployment again within a minute", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockReturnValue(String(Date.now()));
    const set = vi.spyOn(Storage.prototype, "setItem");
    render(<GlobalError error={new Error("Loading chunk 123 failed.")} reset={vi.fn()} />);
    expect(get).toHaveBeenCalledWith("diveday:stale-deploy-reloaded");
    expect(set).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("leaves the fallback visible when storage access is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem");
    render(<GlobalError error={new Error("Loading chunk 123 failed.")} reset={vi.fn()} />);
    expect(set).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
