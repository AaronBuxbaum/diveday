import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";

/**
 * **What a dead claim link is allowed to claim** (ADR 20260827-first-light,
 * decisions 3 and 4; slice 10c).
 *
 * `getClaimPageState` answers `dead` for six different causes and cannot tell
 * them apart on purpose — a dead token is read for its shop and for nothing
 * else, which is the guarantee the whole capability model rests on. So the one
 * sentence the dead card renders is said equally to a spent link, an expired
 * one, a seat somebody else took, a seat the shop cancelled, a departure called
 * off for weather, and a boat that has already sailed.
 *
 * The draft of this slice said "This one has already been used or run out. Your
 * seat is safe with your organizer — ask them for a fresh link." Both halves are
 * defects rather than infelicities. The first asserts a seat that, for four of
 * the six, does not exist any more: a shop calls Saturday off for weather, every
 * party member taps the URL from the group chat, and the page tells each of them
 * their seat is safe and to ask the organizer — so they can reasonably turn up
 * at the dock. The second names a remedy nobody can supply:
 * `issuePartySeatClaims` is the only place a claim link is ever minted and it
 * returns `claim: null` the moment the seat can no longer change hands, so the
 * organizer's panel shows a name and no link to forward.
 *
 * This file is the ratchet on both. Every assertion runs against both locales,
 * because a sentence that claims nothing in English and reassures in Spanish is
 * not this design.
 */
const LOCALES = Object.entries(DIVER_MESSAGES);

/** The route's own source — the reason the sentence has to be cause-neutral. */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

/** How many times a marker appears in the route's source. */
function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

describe("the dead claim link's sentence", () => {
  it.each(LOCALES)("asserts nothing about the seat in %s", (_locale, messages) => {
    const body = messages.seatClaim.expiredBody;
    expect(body.trim()).not.toBe("");
    // The possessive is the whole defect: a page that has read no booking may
    // not tell a diver whose departure was cancelled that the seat is theirs.
    expect(body).not.toMatch(/your seat|tu plaza/i);
    expect(body).not.toMatch(/safe|a salvo/i);
  });

  it.each(LOCALES)("promises no link the organizer cannot mint in %s", (_l, messages) => {
    // `issuePartySeatClaims` mints nothing for a seat that can no longer change
    // hands, which is true of five of this arm's six causes — so "ask them for
    // a fresh link" sends the diver to a panel that has none.
    expect(messages.seatClaim.expiredBody).not.toMatch(/fresh link|enlace nuevo|nuevo enlace/i);
  });

  it.each(LOCALES)("is one sentence in %s", (_locale, messages) => {
    // One terminator, and it is the last character. The card already carries
    // the shop's own contact line under it; a second sentence here would be a
    // page explaining a refusal it cannot account for.
    const body = messages.seatClaim.expiredBody;
    expect(body.match(/[.!?]/g)).toHaveLength(1);
    expect(body.trimEnd().endsWith(".")).toBe(true);
  });

  it.each(LOCALES)("stays a different sentence from the bare door's in %s", (_l, messages) => {
    // The `unknown` tier resolves no record, so a fresh link may genuinely
    // still exist for it and its sentence may still say so. Collapsing the two
    // would drag that promise back into the tier that cannot keep it.
    expect(messages.seatClaim.unavailableBody.trim()).not.toBe("");
    expect(messages.seatClaim.unavailableBody).not.toBe(messages.seatClaim.expiredBody);
  });

  it("renders one dead card carrying one sentence", () => {
    // The structural half: no branch on this page may pick a different sentence
    // per cause, because the state reader deliberately does not carry the cause.
    // If that ever changes it changes here first, and the assertions above stop
    // being the constraint they are.
    expect(countOf("<ExpiredLinkCard")).toBe(1);
    expect(countOf('t("seatClaim.expiredBody")')).toBe(1);
  });
});
