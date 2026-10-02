// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  BOAT_MODE_CLASS,
  BOAT_MODE_STORAGE_KEY,
  boatModeScript,
  isBoatModeOn,
  setBoatMode,
} from "./boat-mode";

afterEach(() => {
  document.documentElement.classList.remove("boat-mode");
  localStorage.clear();
});

describe("Boat mode", () => {
  it("is off until someone switches it on", () => {
    new Function(boatModeScript())();
    expect(isBoatModeOn()).toBe(false);
  });

  it("comes back on before first paint once switched on", () => {
    setBoatMode(true);
    document.documentElement.classList.remove("boat-mode");
    new Function(boatModeScript())();
    expect(isBoatModeOn()).toBe(true);
  });

  it("forgets the choice when switched off", () => {
    setBoatMode(true);
    setBoatMode(false);
    expect(isBoatModeOn()).toBe(false);
    expect(localStorage.getItem(BOAT_MODE_STORAGE_KEY)).toBeNull();
  });

  it("reads the same key and sets the same class the switch does", () => {
    expect(boatModeScript()).toContain(JSON.stringify(BOAT_MODE_STORAGE_KEY));
    expect(boatModeScript()).toContain(`add(${JSON.stringify(BOAT_MODE_CLASS)})`);
  });
});
