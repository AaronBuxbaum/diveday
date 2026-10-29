// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetReturningDiver,
  loadReturningDiver,
  RETURNING_DIVER_MEMORY_MS,
  saveReturningDiver,
  snapshotReturningDiverClearGenerations,
} from "@/lib/returning-diver";
import { usePartyMembers } from "./use-party-members";

const SERVER_NOW = new Date("2026-10-28T12:00:00.000Z");
const receiptA = "00000000-0000-4000-8000-000000000011";
const receiptB = "00000000-0000-4000-8000-000000000012";

const getTrustedServerTime = vi.fn(async () => SERVER_NOW.getTime());

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function save(shopSlug: string, name: string, email: string, receiptId: string, order: string) {
  const generation = snapshotReturningDiverClearGenerations()?.[shopSlug] ?? null;
  saveReturningDiver(
    shopSlug,
    { fullName: name, email },
    SERVER_NOW.getTime() + RETURNING_DIVER_MEMORY_MS,
    SERVER_NOW,
    { id: receiptId, order, generationAtStart: generation },
  );
  return generation;
}

describe("usePartyMembers", () => {
  it("fills the lead's slot from what the page knows, and nothing else", () => {
    const { result } = renderHook(() =>
      usePartyMembers({ fullName: "Ana Ruiz", email: null }, "blue-mantis"),
    );
    expect(result.current.party[0]).toEqual({ fullName: "Ana Ruiz", email: "" });
    expect(result.current.party[1]).toEqual({ fullName: "", email: "" });
    expect(getTrustedServerTime).not.toHaveBeenCalled();
  });

  it("fills only from a valid remembered diver after checking server time", async () => {
    save("blue-mantis", "Priya Shah", "priya@example.com", receiptA, "1");
    const { result } = renderHook(() => usePartyMembers(null, "blue-mantis", getTrustedServerTime));
    await waitFor(() => expect(result.current.rememberedDiver?.fullName).toBe("Priya Shah"));
    expect(result.current.party[0]).toEqual({
      fullName: "Priya Shah",
      email: "priya@example.com",
    });
    expect(getTrustedServerTime).toHaveBeenCalledTimes(1);

    act(() => result.current.forgetRememberedDiver());
    expect(result.current.rememberedDiver).toBeNull();
    expect(result.current.party[0]).toEqual({ fullName: "", email: "" });
    expect(loadReturningDiver("blue-mantis")).toBeNull();
  });

  it("uses server time so a rolled-back device clock cannot revive an expired entry", async () => {
    const shopSlug = "clock-check";
    const generation = snapshotReturningDiverClearGenerations()?.[shopSlug] ?? null;
    saveReturningDiver(
      shopSlug,
      { fullName: "Expired diver", email: "expired@example.com" },
      new Date("2010-01-01T00:00:00.000Z").getTime(),
      new Date("2009-01-01T00:00:00.000Z"),
      { id: receiptA, order: "1", generationAtStart: generation },
    );
    expect(loadReturningDiver("clock-check", new Date("2009-06-01T00:00:00.000Z"))).toEqual({
      fullName: "Expired diver",
      email: "expired@example.com",
    });
    const { result } = renderHook(() => usePartyMembers(null, shopSlug, getTrustedServerTime));
    await waitFor(() => expect(getTrustedServerTime).toHaveBeenCalledTimes(1));
    expect(result.current.party[0]).toEqual({ fullName: "", email: "" });
    expect(result.current.rememberedDiver).toBeNull();
  });

  it("clears remembered fields in another open form while preserving manual edits", async () => {
    const shopSlug = "open-form";
    save(shopSlug, "Priya Shah", "priya@example.com", receiptA, "1");
    const { result } = renderHook(() => usePartyMembers(null, shopSlug, getTrustedServerTime));
    await waitFor(() => expect(result.current.rememberedDiver?.fullName).toBe("Priya Shah"));
    act(() => result.current.updateMember(0, { email: "manual@example.com" }));

    const generation = "33333333-3333-4333-8333-333333333333";
    const expiresAt = SERVER_NOW.getTime() + 86_400_000;
    const key = `diveday:returning-diver:clear:v2:${shopSlug}`;
    const clearMarker = JSON.stringify({ generation, blockedReceiptId: receiptA, expiresAt });
    act(() => {
      localStorage.setItem(key, clearMarker);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: clearMarker }));
    });

    await waitFor(() => expect(result.current.rememberedDiver).toBeNull());
    expect(result.current.party[0]).toEqual({ fullName: "", email: "manual@example.com" });
  });

  it("keeps a later deliberate opt-in when an older clear event arrives late", async () => {
    const shopSlug = "new-opt-in";
    save(shopSlug, "Old diver", "old@example.com", receiptA, "1");
    const { result } = renderHook(() => usePartyMembers(null, shopSlug, getTrustedServerTime));
    await waitFor(() => expect(result.current.rememberedDiver?.fullName).toBe("Old diver"));
    act(() => forgetReturningDiver(shopSlug));
    const generation = snapshotReturningDiverClearGenerations()?.[shopSlug];
    expect(generation).toBeTruthy();
    save(shopSlug, "New diver", "new@example.com", receiptB, "2");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("diveday:returning-diver:cleared", {
          detail: {
            shopSlug,
            generation,
            expiresAt: SERVER_NOW.getTime() + 86_400_000,
            receiptId: receiptA,
          },
        }),
      );
    });

    await waitFor(() => expect(result.current.rememberedDiver?.fullName).toBe("New diver"));
    expect(result.current.party[0]).toEqual({ fullName: "New diver", email: "new@example.com" });
  });

  it("asks nothing of the device when remembering is off", () => {
    renderHook(() => usePartyMembers(null, null));
    expect(getTrustedServerTime).not.toHaveBeenCalled();
  });

  it("checks trusted time only when stored memories need expiry cleanup", async () => {
    const expiredKey = "diveday:returning-diver:v2:red-reef:00000000-0000-4000-8000-000000000013";
    localStorage.setItem(
      expiredKey,
      JSON.stringify({
        fullName: "Expired diver",
        email: "expired@example.com",
        expiresAt: SERVER_NOW.getTime() - 1,
      }),
    );
    renderHook(() => usePartyMembers(null, "blue-mantis", getTrustedServerTime));
    await waitFor(() => expect(localStorage.getItem(expiredKey)).toBeNull());
    expect(getTrustedServerTime).toHaveBeenCalledTimes(1);
  });

  it("does not make a trusted-time request when no shop memories are stored", () => {
    renderHook(() => usePartyMembers(null, "blue-mantis", getTrustedServerTime));
    expect(getTrustedServerTime).not.toHaveBeenCalled();
  });

  it("updates one member and leaves the rest", () => {
    const { result } = renderHook(() => usePartyMembers(null, null));
    act(() => result.current.updateMember(2, { email: "kid@example.com" }));
    expect(result.current.party[2]).toEqual({ fullName: "", email: "kid@example.com" });
    expect(result.current.party[1]).toEqual({ fullName: "", email: "" });
  });
});
