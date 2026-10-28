// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetReturningDiver, loadReturningDiver } from "@/lib/returning-diver";
import { usePartyMembers } from "./use-party-members";

vi.mock("@/lib/returning-diver", () => ({
  forgetReturningDiver: vi.fn(),
  loadReturningDiver: vi.fn(),
}));

const remembered = vi.mocked(loadReturningDiver);

afterEach(() => {
  cleanup();
  remembered.mockReset();
});

describe("usePartyMembers", () => {
  it("fills the lead's slot from what the page knows, and nothing else", () => {
    const { result } = renderHook(() =>
      usePartyMembers({ fullName: "Ana Ruiz", email: null }, "blue-mantis"),
    );
    expect(result.current.party[0]).toEqual({ fullName: "Ana Ruiz", email: "" });
    expect(result.current.party[1]).toEqual({ fullName: "", email: "" });
    expect(remembered).not.toHaveBeenCalled();
  });

  it("fills the first slot from the remembered diver, and forgets it on request", () => {
    remembered.mockReturnValue({ fullName: "Priya Shah", email: "priya@example.com" } as never);
    const { result } = renderHook(() => usePartyMembers(null, "blue-mantis"));
    expect(result.current.rememberedDiver?.fullName).toBe("Priya Shah");
    expect(result.current.party[0]).toEqual({ fullName: "Priya Shah", email: "priya@example.com" });
    act(() => result.current.forgetRememberedDiver());
    expect(result.current.rememberedDiver).toBeNull();
    expect(result.current.party[0]).toEqual({ fullName: "", email: "" });
    expect(forgetReturningDiver).toHaveBeenCalledWith("blue-mantis");
  });

  it("asks nothing of the device when remembering is off", () => {
    renderHook(() => usePartyMembers(null, null));
    expect(remembered).not.toHaveBeenCalled();
  });

  it("updates one member and leaves the rest", () => {
    const { result } = renderHook(() => usePartyMembers(null, null));
    act(() => result.current.updateMember(2, { email: "kid@example.com" }));
    expect(result.current.party[2]).toEqual({ fullName: "", email: "kid@example.com" });
    expect(result.current.party[1]).toEqual({ fullName: "", email: "" });
  });
});
