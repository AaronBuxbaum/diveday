// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffActivity } from "./StaffActivity";

const copy = { title: "Session paused", body: "Reconnect", retry: "Try again", signIn: "Sign in" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("staff activity", () => {
  it("never treats mount, synthetic input, or a passive visibility read as activity", async () => {
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ remainingMs: 5000 })),
    );
    await act(async () => {
      render(
        <div id="staff-session-content">
          <StaffActivity sessionId="one" copy={copy} />
        </div>,
      );
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockClear();
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.pointerDown(document);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("exposes when the first live session check has finished", async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<StaffActivity sessionId="one" copy={copy} />);
    expect(document.querySelector('[data-staff-session-check="pending"]')).not.toBeNull();
    await act(async () => {});
    expect(document.body.lastElementChild).toHaveAttribute("data-staff-session-lock");
    await act(async () => {
      release(new Response(JSON.stringify({ remainingMs: 5000 })));
    });
    expect(document.body.lastElementChild).not.toHaveAttribute("data-staff-session-lock");
    expect(document.querySelector('[data-staff-session-check="settled"]')).not.toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("settles the marker when a pending input is refused during a visibility check", async () => {
    let finishPost!: (response: Response) => void;
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ remainingMs: 5000 })))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPost = resolve;
          }),
      );
    const listeners = vi.spyOn(document, "addEventListener");
    await act(async () => {
      render(<StaffActivity sessionId="one" copy={copy} />);
    });
    const pointer = listeners.mock.calls.find(([name]) => name === "pointerdown")?.[1];
    if (typeof pointer !== "function") throw new Error("pointer handler missing");
    await act(async () => {
      pointer({ isTrusted: true } as Event);
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.querySelector('[data-staff-session-check="pending"]')).not.toBeNull();
    await act(async () => {
      finishPost(new Response(null, { status: 401 }));
    });
    expect(document.querySelector('[data-staff-session-check="settled"]')).not.toBeNull();
    expect(screen.getByRole("alertdialog")).toBeVisible();
    listeners.mockRestore();
  });

  it("covers and makes staff content inert when the session cannot be confirmed", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const otherPortal = document.createElement("div");
    otherPortal.innerHTML = "<button>Private sheet</button>";
    document.body.append(otherPortal);
    await act(async () => {
      render(
        <div id="staff-session-content">
          <p>Private staff data</p>
          <StaffActivity sessionId="one" copy={copy} />
        </div>,
      );
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Session paused");
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription("Reconnect");
    expect(document.getElementById("staff-session-content")?.parentElement?.inert).toBe(true);
    expect(otherPortal.inert).toBe(true);
    expect(screen.getByRole("alertdialog")).toHaveFocus();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?session=ended",
    );
  });

  it("never uncovers the page when an older successful check arrives after a newer refusal", async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ remainingMs: 1000 })))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await act(async () => {
      render(
        <div id="staff-session-content">
          <StaffActivity sessionId="one" copy={copy} />
        </div>,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {});
    await act(async () => {
      release(new Response(JSON.stringify({ remainingMs: 5000 })));
    });
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });

  it("subtracts a delayed confirmation from the server's remaining time", async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(
      <div id="staff-session-content">
        <StaffActivity sessionId="one" copy={copy} />
      </div>,
    );
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      release(new Response(JSON.stringify({ remainingMs: 5000 })));
    });
    await act(async () => {
      vi.advanceTimersByTime(3999);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });
});
