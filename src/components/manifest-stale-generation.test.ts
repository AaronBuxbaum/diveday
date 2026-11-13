import { expect, it, vi } from "vitest";
import {
  invalidateManifestRead,
  manifestStaleGeneration,
  requestManifestReread,
  satisfyPendingManifestReread,
  subscribeManifestReread,
} from "./manifest-stale-generation";

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
