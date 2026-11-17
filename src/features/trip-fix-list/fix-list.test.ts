import { describe, expect, it } from "vitest";
import {
  ADVISORY_REASONS,
  BLOCKER_REASONS,
  type FixGuest,
  fixListOf,
  isBlockerReason,
  reasonRank,
  remedyFor,
} from "./fix-list";

const guest = (id: string, over: Partial<FixGuest> = {}): FixGuest => ({
  id,
  blockers: [],
  advisories: [],
  checkedIn: false,
  released: null,
  ...over,
});

describe("every reason the roster knows", () => {
  it.each(BLOCKER_REASONS)("blocker %s lands in Can't board yet with a remedy", (code) => {
    const list = fixListOf([guest("a", { blockers: [code] })], { mode: "all" });
    expect(list.blocking).toEqual([
      { guestIds: ["a"], reason: code, more: 0, remedy: remedyFor(code), secondRemedy: null },
    ]);
    expect(list.worthAMinute).toEqual([]);
    expect(list.fine).toEqual([]);
    expect(isBlockerReason(code)).toBe(true);
    expect(reasonRank(code)).toBeLessThan(reasonRank("earlier_refusal"));
  });

  it.each(ADVISORY_REASONS)("advisory %s never blocks", (code) => {
    const list = fixListOf([guest("a", { advisories: [code] })], { mode: "all" });
    expect(list.blocking).toEqual([]);
    expect(list.worthAMinute.map((item) => item.reason)).toEqual([code]);
    expect(isBlockerReason(code)).toBe(false);
  });

  it("names a remedy for each reason, by family", () => {
    expect(remedyFor("waiver_not_sent")).toBe("send_waiver");
    expect(remedyFor("guardian_signature_missing")).toBe("send_waiver");
    expect(remedyFor("waiver_unsigned")).toBe("send_waiver");
    expect(remedyFor("payment_due")).toBe("take_payment");
    expect(remedyFor("payment_unpaid")).toBe("take_payment");
    expect(remedyFor("certification_missing")).toBe("review_cards");
    expect(remedyFor("nitrox_pending")).toBe("review_cards");
    expect(remedyFor("identity_unconfirmed")).toBe("confirm_identity");
    expect(remedyFor("medical_review")).toBe("review_medical");
    expect(remedyFor("medical_not_cleared")).toBe("review_medical");
    expect(remedyFor("waiver_seal_failed")).toBe("review_medical");
    expect(remedyFor("course_form_unsigned")).toBe("course_forms");
    expect(remedyFor("contact_missing")).toBe("add_contact");
    expect(remedyFor("fit_needed")).toBe("fit_gear");
    expect(remedyFor("requirements_not_configured")).toBe("open");
    expect(remedyFor("readiness_unavailable")).toBe("open");
  });
});

describe("the blocking group is exactly what readiness refuses", () => {
  it("files a guest with a blocker and advisories under blocking only", () => {
    const list = fixListOf(
      [guest("a", { blockers: ["payment_due"], advisories: ["depth", "contact_missing"] })],
      { mode: "all" },
    );
    expect(list.blocking.map((item) => item.guestIds)).toEqual([["a"]]);
    expect(list.worthAMinute).toEqual([]);
  });

  it("names the first blocker by priority and counts the rest", () => {
    const [item] = fixListOf(
      [guest("a", { blockers: ["payment_due", "waiver_not_sent", "medical_review"] })],
      { mode: "all" },
    ).blocking;
    expect(item).toEqual({
      guestIds: ["a"],
      reason: "medical_review",
      more: 2,
      remedy: "review_medical",
      secondRemedy: "send_waiver",
    });
  });

  it("names the held identity before anything measured against the matched person", () => {
    const [item] = fixListOf(
      [guest("a", { blockers: ["certification_missing", "identity_unconfirmed"] })],
      { mode: "all" },
    ).blocking;
    expect(item?.reason).toBe("identity_unconfirmed");
  });

  it("never groups blockers, even when guests share one", () => {
    const list = fixListOf(
      [guest("a", { blockers: ["waiver_not_sent"] }), guest("b", { blockers: ["waiver_not_sent"] })],
      { mode: "all" },
    );
    expect(list.blocking.map((item) => item.guestIds)).toEqual([["a"], ["b"]]);
  });

  it("keeps a guest who checked in and then went blocked in blocking", () => {
    const list = fixListOf([guest("a", { checkedIn: true, blockers: ["waiver_lapsed"] })], {
      mode: "checkin",
    });
    expect(list.blocking).toHaveLength(1);
    expect(list.fine).toEqual([]);
  });
});

describe("worth a minute", () => {
  it("groups guests who share one advisory and nothing else", () => {
    const list = fixListOf(
      [
        guest("a", { advisories: ["fit_needed"] }),
        guest("b", { advisories: ["fit_needed", "recency"] }),
        guest("c", { advisories: ["fit_needed"] }),
      ],
      { mode: "all" },
    );
    expect(list.worthAMinute.map((item) => [item.guestIds, item.reason])).toEqual([
      [["a", "c"], "fit_needed"],
      [["b"], "fit_needed"],
    ]);
  });

  it("folds everyone with nothing to say into fine", () => {
    const list = fixListOf([guest("a"), guest("b", { checkedIn: true })], { mode: "all" });
    expect(list.fine).toEqual(["a", "b"]);
  });
});

describe("at Check-in", () => {
  it("puts a guest not here yet whom nothing holds up under To come, with their phrase", () => {
    const list = fixListOf([guest("a", { advisories: ["fit_needed"] }), guest("b")], {
      mode: "checkin",
    });
    expect(list.toCome.map((item) => [item.guestIds[0], item.reason])).toEqual([
      ["a", "fit_needed"],
      ["b", null],
    ]);
    expect(list.worthAMinute).toEqual([]);
  });

  it("keeps a guest who is here in worth a minute only for what the desk still owes", () => {
    const list = fixListOf(
      [
        guest("a", { checkedIn: true, advisories: ["contact_missing", "depth"] }),
        guest("b", { checkedIn: true, advisories: ["depth", "recency"] }),
      ],
      { mode: "checkin" },
    );
    expect(list.worthAMinute.map((item) => [item.guestIds, item.reason])).toEqual([
      [["a"], "contact_missing"],
    ]);
    expect(list.fine).toEqual(["b"]);
  });

  it("sets released guests apart and never in a fix", () => {
    const list = fixListOf(
      [
        guest("a", { released: "not_here", blockers: ["waiver_not_sent"] }),
        guest("b", { released: "turned_away", blockers: ["certification_missing"] }),
      ],
      { mode: "checkin" },
    );
    expect(list.notHere).toEqual(["a"]);
    expect(list.turnedAway).toEqual(["b"]);
    expect(list.blocking).toEqual([]);
  });
});
