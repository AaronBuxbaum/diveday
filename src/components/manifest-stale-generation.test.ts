import { expect, it, vi } from "vitest";
import {
  invalidateManifestRead,
  manifestStaleGeneration,
  markManifestReadStale,
  requestManifestReread,
  satisfyPendingManifestReread,
  subscribeManifestReread,
} from "./manifest-stale-generation";

it("defers a bounded retry until a later activation", () => {
  const trip = "budget-deferred";
  const first = vi.fn(() => true);
  const stopFirst = subscribeManifestReread(trip, first);
  markManifestReadStale(trip);
  markManifestReadStale(trip);
  markManifestReadStale(trip);
  expect(first).toHaveBeenCalledTimes(2);
  stopFirst();
  const replacement = vi.fn(() => true);
  const stopReplacement = subscribeManifestReread(trip, replacement);
  try {
    expect(replacement).toHaveBeenCalledOnce();
  } finally {
    stopReplacement();
  }
});

it("charges a deferred read when its owner starts and keeps a third refusal pending", () => {
  const trip = "deferred-budget";
  expect(markManifestReadStale(trip)).toBe(false);
  const owner = vi.fn(() => true);
  const stop = subscribeManifestReread(trip, owner);
  try {
    expect(owner).toHaveBeenCalledTimes(1);
    markManifestReadStale(trip);
    markManifestReadStale(trip);
    expect(owner).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
  const next = vi.fn(() => true);
  const stopNext = subscribeManifestReread(trip, next);
  try {
    expect(next).toHaveBeenCalledOnce();
  } finally {
    stopNext();
  }
});

it("routes a late refusal to its own trip's current owner", () => {
  const oldTrip = "old-trip";
  const newTrip = "new-trip";
  const oldOwner = vi.fn(() => true);
  const newOwner = vi.fn(() => true);
  const stopOld = subscribeManifestReread(oldTrip, oldOwner);
  const stopNew = subscribeManifestReread(newTrip, newOwner);
  try {
    const before = manifestStaleGeneration(oldTrip);
    markManifestReadStale(oldTrip);
    satisfyPendingManifestReread(oldTrip, before);
    expect(oldOwner).toHaveBeenCalledOnce();
    expect(newOwner).not.toHaveBeenCalled();
  } finally {
    stopOld();
    stopNew();
  }
});

it("does not roll back a nested started attempt when the outer owner returns false", () => {
  const trip = "reentrant-stale";
  let calls = 0;
  const owner = vi.fn(() => {
    calls += 1;
    if (calls === 1) {
      markManifestReadStale(trip);
      return false;
    }
    return true;
  });
  const stop = subscribeManifestReread(trip, owner);
  try {
    markManifestReadStale(trip);
    markManifestReadStale(trip);
    expect(owner).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it("retains a deferred reread until an owner starts it", () => {
  const trip = "deferred-reread";
  expect(requestManifestReread(trip)).toBe(false);
  const owner = vi.fn(() => true);
  const stop = subscribeManifestReread(trip, owner);
  try {
    expect(owner).toHaveBeenCalledOnce();
  } finally {
    stop();
  }
});

it("retries an interrupted reread and does not satisfy a newer generation", () => {
  const trip = "interrupted-reread";
  const generation = manifestStaleGeneration(trip);
  expect(requestManifestReread(trip)).toBe(false);
  const first = vi.fn(() => true);
  const stopFirst = subscribeManifestReread(trip, first);
  expect(first).toHaveBeenCalledOnce();
  invalidateManifestRead(trip);
  satisfyPendingManifestReread(trip, generation);
  stopFirst();
  const replacement = vi.fn(() => true);
  const stopReplacement = subscribeManifestReread(trip, replacement);
  try {
    expect(replacement).toHaveBeenCalledOnce();
  } finally {
    stopReplacement();
  }
});

it("does not choose between two simultaneous owners", () => {
  const trip = "ambiguous-reread";
  const first = vi.fn(() => true);
  const second = vi.fn(() => true);
  const stopFirst = subscribeManifestReread(trip, first);
  const stopSecond = subscribeManifestReread(trip, second);
  try {
    expect(requestManifestReread(trip)).toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  } finally {
    stopFirst();
    stopSecond();
  }
});
