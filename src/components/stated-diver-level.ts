"use client";

import { useEffect, useState } from "react";

/**
 * **What a reader said their card is, kept in this browser and nowhere else.**
 *
 * The public departure page has no diver on file — an anonymous visitor is who
 * it is written for — so the day-ceiling picker keeps the answer in
 * `localStorage` (ADR 20260814-self-declared-cards). This module is that key
 * and the two controls that share it: the picker at the top of the page writes
 * it, and the wait-list field further down offers it back rather than asking
 * the same question a second time.
 *
 * It lives under `src/components` rather than beside the picker because
 * `pnpm check:architecture` refuses `src/components -> src/app`: the field
 * cannot import from a route folder, so the key moves down to where both can
 * reach it.
 */

/**
 * Unchanged from the picker's own constant. Never rename it: #1484 already put
 * this key in readers' browsers, and a new name silently forgets what they
 * said.
 */
export const STATED_LEVEL_STORAGE_KEY = "diveday.diver-level";

/**
 * Same-tab notification, because `storage` only fires in *other* tabs. Two
 * controls on one page have to hear each other, so a reader who answers the
 * picker sees the offer appear below without a reload — the pattern
 * `WaterLocker` already uses.
 */
export const STATED_LEVEL_CHANGE_EVENT = "diveday:stated-diver-level-change";

/** The stored answer, or `""`. Never throws: a browser refusing storage is not a reason to break a public page. */
export function readStatedLevel(): string {
  try {
    return window.localStorage.getItem(STATED_LEVEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Store the answer and tell this tab. Never throws; the page works, the answer just is not remembered. */
export function writeStatedLevel(value: string): void {
  try {
    window.localStorage.setItem(STATED_LEVEL_STORAGE_KEY, value);
  } catch {
    // Same again.
  }
  try {
    window.dispatchEvent(new CustomEvent(STATED_LEVEL_CHANGE_EVENT));
  } catch {
    // A browser without CustomEvent still gets the stored value on next load.
  }
}

/**
 * The stated level, live.
 *
 * `""` on the first render, always — the server has no browser storage, so
 * seeding state from it would hydrate a different control than the one the
 * server sent. The read happens after mount, and again whenever the picker
 * writes (same tab) or another tab does (`storage`).
 */
export function useStatedDiverLevel(): string {
  const [level, setLevel] = useState("");
  useEffect(() => {
    const sync = () => setLevel(readStatedLevel());
    sync();
    window.addEventListener(STATED_LEVEL_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(STATED_LEVEL_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return level;
}
