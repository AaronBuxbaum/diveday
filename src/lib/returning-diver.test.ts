// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetReturningDiver,
  loadReturningDiver,
  RETURNING_DIVER_MEMORY_MS,
  saveReturningDiver,
} from "./returning-diver";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const diver = { fullName: "Marco Reyes", email: "marco@example.com" };

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("opted-in returning-diver memory", () => {
  it("saves only when the caller explicitly asks, scoped to one shop", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();

    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);

    expect(loadReturningDiver("blue-mantis", NOW)).toEqual(diver);
    expect(loadReturningDiver("red-reef", NOW)).toBeNull();
  });

  it("expires at the 30-day boundary and removes the stored personal data", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);

    expect(loadReturningDiver("blue-mantis", new Date(expiresAt - 1))).toEqual(diver);
    expect(loadReturningDiver("blue-mantis", new Date(expiresAt))).toBeNull();
    expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
  });

  it("purges expired entries for other shops whenever a shop memory is read", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);
    localStorage.setItem(
      "diveday:returning-diver:v2:red-reef",
      JSON.stringify({
        fullName: "Priya Shah",
        email: "priya@example.com",
        expiresAt: NOW.getTime(),
      }),
    );

    expect(loadReturningDiver("blue-mantis", NOW)).toEqual(diver);
    expect(localStorage.getItem("diveday:returning-diver:v2:red-reef")).toBeNull();
  });

  it("purges expired entries for other shops whenever a shop memory is written", () => {
    localStorage.setItem(
      "diveday:returning-diver:v2:red-reef",
      JSON.stringify({
        fullName: "Priya Shah",
        email: "priya@example.com",
        expiresAt: NOW.getTime(),
      }),
    );

    saveReturningDiver("blue-mantis", diver, NOW.getTime() + RETURNING_DIVER_MEMORY_MS, NOW);

    expect(localStorage.getItem("diveday:returning-diver:v2:red-reef")).toBeNull();
    expect(loadReturningDiver("blue-mantis", NOW)).toEqual(diver);
  });

  it("does not write blank or already-expired data", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", { ...diver, fullName: " " }, expiresAt, NOW);
    saveReturningDiver("blue-mantis", { ...diver, email: "" }, expiresAt, NOW);
    saveReturningDiver("blue-mantis", diver, NOW.getTime(), NOW);
    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
  });

  it("clears only the current shop when the diver says it is not them", () => {
    const expiresAt = NOW.getTime() + RETURNING_DIVER_MEMORY_MS;
    saveReturningDiver("blue-mantis", diver, expiresAt, NOW);
    saveReturningDiver(
      "red-reef",
      { fullName: "Priya Shah", email: "priya@example.com" },
      expiresAt,
      NOW,
    );

    forgetReturningDiver("blue-mantis");

    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
    expect(loadReturningDiver("red-reef", NOW)).toEqual({
      fullName: "Priya Shah",
      email: "priya@example.com",
    });
  });

  it("deletes the old unscoped v1 value without migrating it", () => {
    localStorage.setItem("diveday:returning-diver:v1", JSON.stringify(diver));

    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
    expect(localStorage.getItem("diveday:returning-diver:v1")).toBeNull();
  });

  it("ignores malformed scoped data and removes it", () => {
    localStorage.setItem("diveday:returning-diver:v2:blue-mantis", "not json");

    expect(loadReturningDiver("blue-mantis", NOW)).toBeNull();
    expect(localStorage.getItem("diveday:returning-diver:v2:blue-mantis")).toBeNull();
  });

  it("treats unavailable storage as an optional convenience", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(saveReturningDiver("blue-mantis", diver, NOW.getTime() + 1000, NOW)).toBe(false);
    expect(() => loadReturningDiver("blue-mantis", NOW)).not.toThrow();
    expect(() => forgetReturningDiver("blue-mantis")).not.toThrow();
  });
});
