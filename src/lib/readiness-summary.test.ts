import { describe, expect, it } from "vitest";
import type { TripRequirement } from "@/db/schema";
import type { ReadinessResult } from "./readiness";
import { buildDiverChecklist, nextDiverStep, reminderReadiness } from "./readiness-summary";

function requirement(overrides: Partial<TripRequirement> = {}): TripRequirement {
  return {
    shopId: "shop",
    tripId: "trip",
    requiresWaiver: true,
    minimumCertificationLevel: "open_water",
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TripRequirement;
}

const ready: ReadinessResult = { status: "ready", blockers: [] };

describe("buildDiverChecklist", () => {
  it("shows only the categories this trip requires", () => {
    const items = buildDiverChecklist(
      requirement({ minimumCertificationLevel: null, requiresPayment: false }),
      ready,
    );
    expect(items.map((item) => item.category)).toEqual(["waiver"]);
  });

  it("marks a fully ready diver's items done", () => {
    const items = buildDiverChecklist(requirement(), ready);
    expect(items.every((item) => item.state === "done")).toBe(true);
    expect(items.map((item) => item.category)).toEqual(["waiver", "certification", "payment"]);
  });

  it("routes a pending waiver to the diver as an action and carries the code", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "waiver_pending" }],
    });
    const waiver = items.find((item) => item.category === "waiver");
    expect(waiver?.state).toBe("action");
    expect(waiver?.detailCode).toBe("waiver_pending");
    // The code lets the /ready page render the exact "Sign your waiver" action.
    expect(waiver?.code).toBe("waiver_pending");
  });

  it("routes an expired waiver link to the diver, who can now replace it themselves", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "waiver_expired" }],
    });
    const waiver = items.find((item) => item.category === "waiver");
    // Was "waiting" while the only advice we could give was "ask the shop".
    // Both diver surfaces now mint a replacement on the spot, so this is the
    // diver's to clear — and it must carry the code, or /ready has nothing to
    // hang the "Get a fresh waiver link" button off.
    expect(waiver?.state).toBe("action");
    expect(waiver?.detailCode).toBe("waiver_expired");
    expect(waiver?.code).toBe("waiver_expired");
    expect(nextDiverStep(items)?.category).toBe("waiver");
  });

  it("names an expired waiver in pre-trip reminders, like a never-signed one", () => {
    // Enrolled by the product owner on 2026-08-03, having been held out only
    // while the reminder bundle had no line for it. A diver whose link aged out
    // is exactly as unsigned as one who never got a link, so silence until the
    // dock would be the worse failure. The inverse of this assertion guarded
    // the gap before the copy existed.
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "waiver_expired" }],
    });
    expect(reminderReadiness(items).outstanding).toEqual(["waiver_expired"]);
  });

  it("puts an unconfirmed imported specialty card on the shop, not the diver", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "specialty_import_unconfirmed" }],
    });
    const cert = items.find((item) => item.category === "certification");
    // The card is already on file — there is nothing for the diver to send, so
    // this must never read as an action or ask them to chase a card.
    expect(cert?.state).toBe("waiting");
    expect(cert?.detailCode).toBe("specialty_import_unconfirmed");
  });

  it("never claims an email is coming for an unsent waiver", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "waiver_not_sent" }],
    });
    const waiver = items.find((item) => item.category === "waiver");
    // Must route to the "hasn't sent yet" line, never the "on its way" one —
    // there's no auto-send, so promising a delivery would be a lie.
    expect(waiver?.detailCode).toBe("waiver_not_sent");
    expect(waiver?.code).toBe("waiver_not_sent");
  });

  it("routes a card pending verification to the shop as waiting, not a diver action", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "certification_pending" }],
    });
    const cert = items.find((item) => item.category === "certification");
    expect(cert?.state).toBe("waiting");
  });

  it("does not nag about a medical review the diver cannot clear", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "medical_review" }],
    });
    const waiver = items.find((item) => item.category === "waiver");
    expect(waiver?.state).toBe("waiting");
    expect(nextDiverStep(items)).toBeNull();
  });

  it("lets a diver action outrank a shop-waiting blocker in the same category", () => {
    const items = buildDiverChecklist(requirement({ requiresNitrox: true }), {
      status: "blocked",
      blockers: [{ code: "certification_pending" }, { code: "nitrox_missing" }],
    });
    const cert = items.find((item) => item.category === "certification");
    expect(cert?.state).toBe("action");
  });

  it("surfaces a dive-site-composed cert blocker even when the trip's own cert fields are blank", () => {
    // The trip requires only a waiver; the dive SITE gate (composed by the
    // engine) is what produced the certification blocker. It must still show —
    // otherwise the diver is told "nothing to do" while missing a card.
    const items = buildDiverChecklist(
      requirement({ minimumCertificationLevel: null, requiresPayment: false }),
      {
        status: "blocked",
        blockers: [{ code: "certification_insufficient" }],
      },
    );
    const cert = items.find((item) => item.category === "certification");
    expect(cert).toBeDefined();
    expect(cert?.state).toBe("action");
    expect(nextDiverStep(items)?.category).toBe("certification");
  });

  it("tells a diver short several cards that it's more than one thing", () => {
    const items = buildDiverChecklist(requirement({ requiresNitrox: true }), {
      status: "blocked",
      blockers: [
        { code: "certification_missing" },
        { code: "specialty_missing" },
        { code: "nitrox_missing" },
      ],
    });
    const cert = items.find((item) => item.category === "certification");
    expect(cert?.state).toBe("action");
    expect(cert?.detailCode).toBe("certification_multiple_needed");
  });

  it("collapses to a single reassuring line when the shop hasn't configured the trip", () => {
    const items = buildDiverChecklist(null, {
      status: "blocked",
      blockers: [{ code: "requirements_not_configured" }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.category).toBe("setup");
    expect(items[0]?.state).toBe("waiting");
  });

  // H-22 (2026-07-25): the age blocker names the real reason, unlike the
  // still-generic identity blocker it used to be word-for-word identical to.
  it("names the real reason for an under-age diver whose identity isn't in question", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "under_minimum_age", params: { age: 8, minimumAge: 10 } }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.category).toBe("setup");
    // The diver-facing detail line (unlike the staff one) never states the
    // diver's actual age back or asserts they're too young outright — the
    // date on file could simply be wrong — which is why its bundle entry
    // (`ready.checklistDetail.underMinimumAge`) carries no age placeholder at
    // all, structurally rather than by a runtime string check here.
    expect(items[0]?.detailCode).toBe("under_minimum_age");
  });

  it("still shows the generic identity line, not the age reason, when both blockers apply", () => {
    // calculateReadiness always pushes identity_unconfirmed before
    // under_minimum_age (src/lib/readiness.ts), and buildDiverChecklist takes
    // the setup bucket's first blocker — this is what keeps the age reason
    // from leaking to a booking whose submitted name doesn't match the one on
    // file, which is the one case H-13's safeguard can actually catch.
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "identity_unconfirmed" }, { code: "under_minimum_age" }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.detailCode).toBe("identity_unconfirmed");
  });
});

describe("nextDiverStep", () => {
  it("returns the first item that is on the diver", () => {
    const items = buildDiverChecklist(requirement(), {
      status: "blocked",
      blockers: [{ code: "payment_due" }],
    });
    expect(nextDiverStep(items)?.category).toBe("payment");
  });

  it("returns null when everything is done or on the shop", () => {
    expect(nextDiverStep(buildDiverChecklist(requirement(), ready))).toBeNull();
  });
});

describe("reminderReadiness", () => {
  const from = (result: ReadinessResult) =>
    reminderReadiness(buildDiverChecklist(requirement(), result));

  it("names the diver's own outstanding actions as terse imperatives", () => {
    const { outstanding, medicalReview } = from({
      status: "blocked",
      blockers: [{ code: "waiver_pending" }, { code: "payment_due" }],
    });
    expect(outstanding).toEqual(["waiver_pending", "payment_due"]);
    expect(medicalReview).toBe(false);
  });

  it("flags a medical review the diver can't clear without naming a to-do", () => {
    const { outstanding, medicalReview } = from({
      status: "blocked",
      blockers: [{ code: "medical_review" }],
    });
    expect(outstanding).toEqual([]);
    expect(medicalReview).toBe(true);
  });

  it("stays empty for a shop-side (waiting) blocker the diver cannot act on", () => {
    expect(from({ status: "blocked", blockers: [{ code: "certification_pending" }] })).toEqual({
      outstanding: [],
      medicalReview: false,
    });
  });

  it("is empty for a fully-ready diver", () => {
    expect(from(ready)).toEqual({ outstanding: [], medicalReview: false });
  });
});
