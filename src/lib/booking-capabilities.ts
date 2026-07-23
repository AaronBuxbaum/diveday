import { createHash, randomBytes } from "node:crypto";

/**
 * A booking capability (CR-002/CR-003) never runs forever: it outlives the
 * trip by a grace window so post-trip follow-up (a late payment, a missed
 * waiver) still works, is capped at a flat ceiling so an early-booked trip
 * doesn't mint a years-long credential, and never expires sooner than a day
 * out even for a same-day booking.
 */
export const CAPABILITY_MAX_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const CAPABILITY_TRIP_GRACE_MS = 48 * 60 * 60 * 1000;
export const CAPABILITY_MIN_TTL_MS = 24 * 60 * 60 * 1000;

export function createCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `min(tripEndsAt + grace, now + max)`, floored at `now + min` so it's never issued dead-on-arrival. */
export function capabilityExpiryFor(tripEndsAt: Date, now: Date): Date {
  const tripBound = tripEndsAt.getTime() + CAPABILITY_TRIP_GRACE_MS;
  const ceiling = now.getTime() + CAPABILITY_MAX_TTL_MS;
  const floor = now.getTime() + CAPABILITY_MIN_TTL_MS;
  return new Date(Math.max(floor, Math.min(tripBound, ceiling)));
}

/** The absolute-path readiness link for an already-issued `readiness` capability token. */
export function readinessLinkPath(token: string): string {
  return `/ready/${token}`;
}
