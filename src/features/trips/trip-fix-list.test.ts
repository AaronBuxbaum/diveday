import { describe, expect, it } from "vitest";
import {
  ADVISORY_REASONS,
  BLOCKER_REASONS,
  type FixGuest,
  fixListOf,
  isBlockerReason,
  quietOnFilling,
  reasonRank,
  remedyFor,
} from "./trip-fix-list";

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
    expect(list.blocking).toEqual([{ guestId: "a", reasons: [code], remedy: remedyFor(code) }]);
    expect(list.worthAMinute).toEqual([]);
    expect(list.fine).toEqual([]);
    expect(isBlockerReason(code)).toBe(true);
    expect(reasonRank(code)).toBeLessThan(reasonRank("earlier_refusal"));
  });

  it.each(ADVISORY_REASONS)("advisory %s never blocks", (code) => {
    const list = fixListOf([guest("a", { advisories: [code] })], { mode: "all" });
    expect(list.blocking).toEqual([]);
    expect(list.worthAMinute.map((item) => item.reasons)).toEqual([[code]]);
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
    expect(list.blocking.map((item) => item.guestId)).toEqual(["a"]);
    expect(list.worthAMinute).toEqual([]);
  });

  it("carries every blocker, worst first", () => {
    const [item] = fixListOf(
      [guest("a", { blockers: ["payment_due", "waiver_not_sent", "medical_review"] })],
      { mode: "all" },
    ).blocking;
    expect(item).toEqual({
      guestId: "a",
      reasons: ["medical_review", "waiver_not_sent", "payment_due"],
      remedy: "review_medical",
    });
  });

  it("names the held identity before anything measured against the matched person", () => {
    const [item] = fixListOf(
      [guest("a", { blockers: ["certification_missing", "identity_unconfirmed"] })],
      { mode: "all" },
    ).blocking;
    expect(item?.reasons[0]).toBe("identity_unconfirmed");
  });

  it("never groups blockers, even when guests share one", () => {
    const list = fixListOf(
      [
        guest("a", { blockers: ["waiver_not_sent"] }),
        guest("b", { blockers: ["waiver_not_sent"] }),
      ],
      { mode: "all" },
    );
    expect(list.blocking.map((item) => item.guestId)).toEqual(["a", "b"]);
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
  it("is one row per person, carrying all their reasons, even when guests share one", () => {
    const list = fixListOf(
      [
        guest("a", { advisories: ["fit_needed"] }),
        guest("b", { advisories: ["fit_needed", "depth", "depth"] }),
        guest("c", { advisories: ["fit_needed"] }),
      ],
      { mode: "all" },
    );
    expect(list.worthAMinute.map((item) => [item.guestId, item.reasons])).toEqual([
      ["a", ["fit_needed"]],
      ["b", ["depth", "fit_needed"]],
      ["c", ["fit_needed"]],
    ]);
  });

  it("names each guest at most once across every group", () => {
    const guests = [
      guest("a", { blockers: ["waiver_not_sent"], advisories: ["depth"] }),
      guest("b", { advisories: ["depth", "fit_needed"] }),
      guest("c", { checkedIn: true, advisories: ["contact_missing", "depth"] }),
      guest("d", { checkedIn: true, advisories: ["depth"] }),
      guest("e", { advisories: ["depth"] }),
      guest("f"),
    ];
    for (const mode of ["all", "checkin"] as const) {
      const list = fixListOf(guests, { mode });
      const named = [
        ...list.blocking.map((item) => item.guestId),
        ...list.worthAMinute.map((item) => item.guestId),
        ...list.toCome.map((item) => item.guestId),
        ...list.fine,
      ];
      expect(named.toSorted()).toEqual(["a", "b", "c", "d", "e", "f"]);
    }
  });

  it("folds everyone with nothing to say into fine", () => {
    const list = fixListOf([guest("a"), guest("b", { checkedIn: true })], { mode: "all" });
    expect(list.fine).toEqual(["a", "b"]);
  });
});

describe("what the crew talks through ranks above what the desk owes", () => {
  it("names the depth before the money on a guest not here yet (domain review F1)", () => {
    const list = fixListOf([guest("a", { advisories: ["payment_unpaid", "depth"] })], {
      mode: "checkin",
    });
    expect(list.toCome[0]?.reasons).toEqual(["depth", "payment_unpaid"]);
  });

  it.each([
    "earlier_refusal",
    "earlier_referral",
    "depth",
    "recency",
    "re_entry_ask",
    "drysuit",
  ] as const)("%s outranks every desk advisory", (crew) => {
    for (const desk of ["waiver_unsigned", "payment_unpaid", "contact_missing"] as const) {
      expect(reasonRank(crew)).toBeLessThan(reasonRank(desk));
    }
  });
});

describe("at Check-in", () => {
  it("puts a guest not here yet whom nothing holds up under To come, with their phrase", () => {
    const list = fixListOf([guest("a", { advisories: ["fit_needed"] }), guest("b")], {
      mode: "checkin",
    });
    expect(list.toCome.map((item) => [item.guestId, item.reasons])).toEqual([
      ["a", ["fit_needed"]],
      ["b", []],
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
    expect(list.worthAMinute.map((item) => [item.guestId, item.reasons])).toEqual([
      ["a", ["contact_missing"]],
    ]);
    expect(list.fine).toEqual(["b"]);
  });

  it("keeps an open help request on a guest who is here, with the crew choice as its remedy", () => {
    const list = fixListOf([guest("a", { checkedIn: true, advisories: ["help_requested"] })], {
      mode: "checkin",
    });
    expect(list.worthAMinute).toEqual([
      { guestId: "a", reasons: ["help_requested"], remedy: "arrange_help" },
    ]);
    expect(list.blocking).toEqual([]);
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

/**
 * **What Filling may say quietly** (dock-operator review, 2026-11-24): the
 * day's routine only. A medical, identity or waiver signal keeps the warning
 * color days ahead, and so does every readiness blocker.
 */
describe("quietOnFilling", () => {
  it("is quiet for the day's routine: depth, recency, fit, drysuit, contact, balance", () => {
    expect(
      quietOnFilling([
        "depth",
        "recency",
        "fit_needed",
        "drysuit",
        "contact_missing",
        "payment_unpaid",
      ]),
    ).toBe(true);
  });

  it("keeps a guest whose only advisory is an earlier referral in the warning color", () => {
    const list = fixListOf(
      [
        {
          id: "g",
          blockers: [],
          advisories: ["earlier_referral"],
          checkedIn: false,
          released: null,
        },
      ],
      { mode: "all" },
    );
    expect(list.blocking).toEqual([]);
    expect(list.worthAMinute.map((item) => item.reasons)).toEqual([["earlier_referral"]]);
    expect(quietOnFilling(list.worthAMinute[0]?.reasons ?? [])).toBe(false);
  });

  it("is never quiet for a medical, identity, waiver, re-entry or help advisory, alone or mixed", () => {
    for (const reason of [
      "earlier_refusal",
      "earlier_referral",
      "more_holds",
      "waiver_unsigned",
      "re_entry_ask",
      "help_requested",
    ] as const) {
      expect(quietOnFilling([reason])).toBe(false);
      expect(quietOnFilling(["depth", reason])).toBe(false);
    }
  });

  it("is never quiet for a readiness blocker, or for nothing at all", () => {
    for (const reason of BLOCKER_REASONS) expect(quietOnFilling([reason])).toBe(false);
    expect(quietOnFilling([])).toBe(false);
  });
});
