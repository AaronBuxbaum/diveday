// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { clearReturningDiver, loadReturningDiver, saveReturningDiver } from "./returning-diver";

afterEach(() => {
  localStorage.clear();
});

describe("returning diver storage", () => {
  it("round-trips a saved diver", () => {
    expect(loadReturningDiver()).toBeNull();
    saveReturningDiver({ fullName: "Marco Reyes", email: "marco@example.com" });
    expect(loadReturningDiver()).toEqual({ fullName: "Marco Reyes", email: "marco@example.com" });
  });

  it("clears the saved diver", () => {
    saveReturningDiver({ fullName: "Marco Reyes", email: "marco@example.com" });
    clearReturningDiver();
    expect(loadReturningDiver()).toBeNull();
  });

  it("never saves a blank name or email", () => {
    saveReturningDiver({ fullName: "", email: "marco@example.com" });
    expect(loadReturningDiver()).toBeNull();
    saveReturningDiver({ fullName: "Marco Reyes", email: "" });
    expect(loadReturningDiver()).toBeNull();
  });

  it("ignores garbage already in storage rather than throwing", () => {
    localStorage.setItem("diveday:returning-diver:v1", "not json");
    expect(loadReturningDiver()).toBeNull();

    localStorage.setItem("diveday:returning-diver:v1", JSON.stringify({ fullName: "Only Name" }));
    expect(loadReturningDiver()).toBeNull();
  });

  it("overwrites the previously saved diver on a later booking", () => {
    saveReturningDiver({ fullName: "Marco Reyes", email: "marco@example.com" });
    saveReturningDiver({ fullName: "Priya Sharma", email: "priya@example.com" });
    expect(loadReturningDiver()).toEqual({ fullName: "Priya Sharma", email: "priya@example.com" });
  });
});
