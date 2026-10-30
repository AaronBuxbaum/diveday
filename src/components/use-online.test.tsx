// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnline } from "./use-online";

function OnlineLabel() {
  const online = useOnline();
  return <span>{online ? "online" : "offline"}</span>;
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useOnline", () => {
  it("uses a stable online server snapshot, then reconciles to the device after hydration", async () => {
    setOnline(false);
    const html = renderToString(<OnlineLabel />);
    expect(html).toContain("online");

    const container = document.createElement("div");
    container.innerHTML = html;
    const recoverableError = vi.fn();
    document.body.append(container);
    const root = hydrateRoot(container, <OnlineLabel />, { onRecoverableError: recoverableError });

    await act(async () => {});

    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(recoverableError).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("tracks online/offline events and removes both listeners on unmount", () => {
    setOnline(true);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<OnlineLabel />);
    expect(screen.getByText("online")).toBeInTheDocument();

    setOnline(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("offline")).toBeInTheDocument();

    setOnline(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.getByText("online")).toBeInTheDocument();

    const handlers = new Map(
      add.mock.calls
        .filter(([event]) => event === "online" || event === "offline")
        .map(([event, handler]) => [event, handler]),
    );
    unmount();
    expect(remove).toHaveBeenCalledWith("online", handlers.get("online"));
    expect(remove).toHaveBeenCalledWith("offline", handlers.get("offline"));
  });
});
