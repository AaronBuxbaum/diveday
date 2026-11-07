import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";

/**
 * **What a dead claim link says** (ADR 20260827-first-light, decisions 3 and
 * 4; the claim page says what happened, Aaron 2026-11-06).
 *
 * `getClaimPageState` names the cause: the trip or the seat was canceled, the
 * seat was claimed, the boat has left, or none of those (`ended`: an expired
 * link, a seat checked in at the desk). Every sentence runs in both locales,
 * because one that is true in English and reassures in Spanish is not this
 * design.
 */
const LOCALES = Object.entries(DIVER_MESSAGES);

function deadBodies(messages: (typeof DIVER_MESSAGES)[keyof typeof DIVER_MESSAGES]) {
  const claim = messages.seatClaim;
  return [
    claim.tripCancelledBody,
    claim.seatCancelledBody,
    claim.claimedBody,
    claim.departedBody,
    claim.expiredBody,
  ];
}

describe("the dead claim link's sentences", () => {
  it.each(LOCALES)("say something for every cause in %s", (_locale, messages) => {
    for (const body of deadBodies(messages)) expect(body.trim()).not.toBe("");
  });

  it.each(LOCALES)("promise no link the organizer cannot mint in %s", (_l, messages) => {
    // `issuePartySeatClaims` mints nothing for a seat that can no longer
    // change hands, so "ask them for a fresh link" sends the diver to a panel
    // that has none.
    for (const body of deadBodies(messages)) {
      expect(body).not.toMatch(/fresh link|enlace nuevo|nuevo enlace/i);
    }
  });

  it.each(LOCALES)("claim nothing about the seat when the cause is unknown in %s", (_l, m) => {
    // `ended` covers an expired link and a seat checked in at the desk: the
    // page cannot say the seat is safe for either.
    expect(m.seatClaim.expiredBody).not.toMatch(/your seat|tu plaza/i);
    expect(m.seatClaim.expiredBody).not.toMatch(/safe|a salvo/i);
  });

  it.each(LOCALES)("stays a different sentence from the bare door's in %s", (_l, messages) => {
    // The `unknown` tier resolves no record, so a fresh link may genuinely
    // still exist for it and its sentence may still say so.
    expect(messages.seatClaim.unavailableBody.trim()).not.toBe("");
    expect(messages.seatClaim.unavailableBody).not.toBe(messages.seatClaim.expiredBody);
  });
});
