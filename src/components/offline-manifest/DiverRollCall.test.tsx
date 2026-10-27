// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineCounter } from "./Counter";
import { OfflineDiverRollCall } from "./DiverRollCall";
import { controls, savedCopy, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

describe("OfflineDiverRollCall", () => {
  it("does not present an older training clearance as boardable", () => {
    const copy = savedCopy();
    const [diver] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!diver) throw new Error("fixture diver missing");
    diver.trainingDive = {
      courseTitle: "Open Water",
      instructorAboard: true,
      siteAttributionUnknown: true,
    };
    diver.readiness = { status: "ready", blockers: [] };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("manifest missing");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector(`#offline-roll-call-${diver.bookingId}`);
    expect(row?.textContent).toContain("This saved training clearance is out of date");
    expect(row?.textContent).toContain("This mark does not identify which dive is training");
    expect(trip.blockedAtRail[0]).toBe(true);
  });

  it("holds an old marked verdict at the offline counter too", () => {
    const copy = savedCopy();
    const [diver] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!diver) throw new Error("fixture diver missing");
    diver.trainingDive = { courseTitle: "Open Water", instructorAboard: true };
    diver.readiness = { status: "ready", blockers: [] };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("manifest missing");
    const { container } = render(<OfflineCounter view={trip} controls={controls()} />);
    expect(container.textContent).toContain("This saved training clearance is out of date");
    const row = [...container.querySelectorAll("li")].find((item) =>
      item.textContent?.includes(diver.fullName),
    );
    expect(row?.querySelector("button")).toBeNull();
  });

  it("keeps every saved blocker beside the stale training warning at the counter and after boarding", () => {
    const copy = savedCopy();
    const [diver] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!diver) throw new Error("fixture diver missing");
    diver.trainingDive = { courseTitle: "Open Water", instructorAboard: true };
    diver.readiness = {
      status: "blocked",
      blockers: [
        { code: "medical_review", text: "Physician referral needs review" },
        { code: "certification_missing", text: "Certification missing when saved" },
      ],
    };
    const departure = offlineTripView(copy, "departure");
    if (!departure) throw new Error("manifest missing");
    const counter = render(<OfflineCounter view={departure} controls={controls()} />);
    const counterRow = [...counter.container.querySelectorAll("li")].find((row) =>
      row.textContent?.includes(diver.fullName),
    );
    expect(counterRow?.textContent).toContain("This saved training clearance is out of date");
    expect(counterRow?.textContent).toContain("Physician referral needs review");
    expect(counterRow?.textContent).toContain("Certification missing when saved");
    expect(counterRow?.querySelector("button")).toBeNull();
    counter.unmount();

    expect(departure.blockedAtRail[0]).toBe(true);
    const dock = render(<OfflineDiverRollCall view={departure} controls={controls()} />);
    const dockRow = dock.container.querySelector(`#offline-roll-call-${diver.bookingId}`);
    expect(dockRow?.textContent).toContain("This saved training clearance is out of date");
    expect(dockRow?.textContent).toContain("Physician referral needs review");
    expect(dockRow?.textContent).toContain("Certification missing when saved");
    expect(dockRow?.querySelector('button[aria-label="Mark boarded"]')).toBeNull();
    dock.unmount();

    copy.events = [
      {
        clientEventId: "event-1",
        snapshotId: "snap-trip-1",
        snapshotSavedAt: "2026-08-01T12:00:00.000Z",
        tripId: "trip-1",
        bookingId: diver.bookingId,
        checkpoint: "departure",
        status: "boarded",
        occurredAt: "2026-08-01T12:58:00.000Z",
        syncStatus: "pending",
      },
    ];
    for (const checkpoint of ["departure", "after_dive_1"] as const) {
      const trip = offlineTripView(copy, checkpoint);
      if (!trip) throw new Error("manifest missing");
      const rendered = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
      const row = rendered.container.querySelector(`#offline-roll-call-${diver.bookingId}`);
      expect(row?.textContent).toContain("This saved training clearance is out of date");
      expect(row?.textContent).toContain("Physician referral needs review");
      expect(row?.textContent).toContain("Certification missing when saved");
      rendered.unmount();
    }
  });

  it("keeps a medical capsule after a dive on a diver boarded over a physician's no, issue 2380", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.readiness = {
      status: "blocked",
      blockers: [{ code: "medical_not_cleared", text: "Physician did not clear" }],
    };
    copy.events = [
      {
        clientEventId: "event-1",
        snapshotId: "snap-trip-1",
        snapshotSavedAt: "2026-08-01T12:00:00.000Z",
        tripId: "trip-1",
        bookingId: "b-priya",
        checkpoint: "departure",
        status: "boarded",
        occurredAt: "2026-08-01T12:58:00.000Z",
        syncStatus: "pending",
      },
    ];
    const rowAt = (checkpoint: "departure" | "after_dive_1" | "after_dive_2") => {
      const trip = offlineTripView(copy, checkpoint);
      if (!trip) throw new Error("the fixture carries a manifest");
      const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
      const text = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
      cleanup();
      return text;
    };
    expect(rowAt("after_dive_1")).toContain("Not medically cleared");
    expect(rowAt("after_dive_2")).toContain("Not medically cleared");
    expect(rowAt("departure")).not.toContain("Not medically cleared");
  });
  it("shows the observation on a diver not back aboard under the status line, outside any disclosure (review dde-b 2)", () => {
    const copy = savedCopy();
    const NOTE = "Surfaced 200 m north, picked up by Reef Runner 11:31";
    const event = (
      checkpoint: "departure" | "after_dive_1",
      status: "boarded" | "not_boarded",
    ) => ({
      clientEventId: `event-${checkpoint}`,
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      checkpoint,
      status,
      occurredAt: "2026-08-01T12:58:00.000Z",
      syncStatus: "pending" as const,
    });
    copy.events = [
      event("departure", "boarded"),
      { ...event("after_dive_1", "not_boarded"), note: NOTE },
    ];
    const trip = offlineTripView(copy, "after_dive_1");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya");
    if (!row) throw new Error("Priya's row missing");
    const notes = [...row.querySelectorAll("p")].filter((p) => p.textContent === NOTE);
    // Said once, and in the open: no tap on "Contact & gear" stands before it.
    expect(notes).toHaveLength(1);
    expect(notes[0]?.closest("details")).toBeNull();
  });

  /**
   * **A block is the status line's ink, not the row's fill** (visual review
   * polish, B01), as in the "At the counter" block: the row keeps the tone of
   * what was recorded, the words say Blocked in danger ink, and aboard over a
   * block is never the calm boarded green. A diver not back aboard keeps the
   * danger fill and ring: that is a recorded state, not a block.
   */
  describe("a blocked diver's row", () => {
    function blockedPriya(status?: "boarded" | "not_boarded", checkpoint = "departure" as const) {
      const copy = savedCopy();
      const priya = copy.snapshot.manifests[0]?.divers.find((d) => d.bookingId === "b-priya");
      if (!priya) throw new Error("fixture diver missing");
      priya.readiness = {
        status: "blocked",
        blockers: [{ code: "waiver_not_sent", text: "Waiver not signed" }],
      };
      copy.events = status
        ? [
            {
              clientEventId: "event-1",
              snapshotId: "snap-trip-1",
              snapshotSavedAt: "2026-08-01T12:00:00.000Z",
              tripId: "trip-1",
              bookingId: "b-priya",
              checkpoint,
              status,
              occurredAt: "2026-08-01T12:58:00.000Z",
              syncStatus: "pending",
            },
          ]
        : [];
      const trip = offlineTripView(copy, checkpoint);
      if (!trip) throw new Error("the fixture carries a manifest");
      const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
      const row = container.querySelector("#offline-roll-call-b-priya");
      if (!row) throw new Error("Priya's row missing");
      const status_ = row.querySelector("h3")?.parentElement?.nextElementSibling;
      return { row, status: status_ };
    }

    it("wears no danger fill or rule while awaiting, and says Blocked in danger ink", () => {
      const { row, status } = blockedPriya();
      expect(row.className).not.toMatch(/\bbg-danger-tint\b|\bborder-danger\b/);
      expect(row).toHaveClass("border-border-strong", "bg-surface-sunken");
      expect(status).toHaveClass("text-danger");
      expect(status?.textContent).toContain("Waiver not signed");
    });

    it("is never the boarded green when boarded over the block", () => {
      const { row, status } = blockedPriya("boarded");
      expect(row.className).not.toMatch(/\bbg-success-tint\b|\bborder-success\b/);
      expect(row.className).not.toMatch(/\bbg-danger-tint\b/);
      expect(status).toHaveClass("text-danger");
    });
  });

  it("keeps the danger fill and ring on a diver recorded not back aboard", () => {
    const copy = savedCopy();
    const event = (
      checkpoint: "departure" | "after_dive_1",
      status: "boarded" | "not_boarded",
    ) => ({
      clientEventId: `event-${checkpoint}`,
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      checkpoint,
      status,
      occurredAt: "2026-08-01T12:58:00.000Z",
      syncStatus: "pending" as const,
    });
    copy.events = [event("departure", "boarded"), event("after_dive_1", "not_boarded")];
    const trip = offlineTripView(copy, "after_dive_1");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    expect(container.querySelector("#offline-roll-call-b-priya")).toHaveClass(
      "border-danger",
      "bg-danger-tint",
      "ring-danger/40",
    );
  });

  it("draws one roll-call row per diver, each its own jump target", () => {
    const { container } = render(<OfflineDiverRollCall view={view()} controls={controls()} />);
    expect(container.querySelector("#offline-roll-call-b-priya")).not.toBeNull();
    expect(container.querySelector("#offline-roll-call-b-marcus")).not.toBeNull();
  });

  it("shows a rider's riding-only warning ahead of the others (H-109)", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture divers missing");
    first.medicalWarnings = { ridingReferredOn: "2026-06-10", refusedOn: "2026-05-02" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const warned = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(warned).toContain("Riding only: referred");
    expect(warned).not.toContain("Physician said no before");
    expect(warned).toMatch(
      /Referred to a physician on Jun\s10,\s2026 with no answer on file: riding only, not in the water/,
    );
  });

  it("shows the live roll call's two medical warnings, in its words", () => {
    // Issue #2163: a crew at the rail with no signal saw neither warning.
    const copy = savedCopy();
    const [first, second] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first || !second) throw new Error("fixture divers missing");
    first.medicalWarnings = { refusedOn: "2026-05-02", referredOn: "2026-06-10" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const warned = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(warned).toContain("Physician said no before");
    // Ranked after the refusal, as on the live roll call: one capsule.
    expect(warned).not.toContain("Referral still open");
    expect(warned).toContain("Contact, gear & medical");
    expect(warned).toMatch(
      /A physician did not clear this person on May\s2,\s2026 \(earlier waiver\)/,
    );
    expect(warned).toMatch(
      /Referred to a physician on Jun\s10,\s2026; re-signed with no physician clearance on file/,
    );
    const plain = container.querySelector("#offline-roll-call-b-marcus")?.textContent ?? "";
    expect(plain).not.toContain("physician");
    expect(plain).not.toContain("medical");
  });

  it("shows the referral capsule when there is no refusal", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.medicalWarnings = { referredOn: "2026-06-10" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(row).toContain("Referral still open");
    expect(row).not.toContain("Physician said no before");
  });

  it("shows a held seat only the contact the desk recorded for it (H7)", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.identityWithheld = true;
    first.emergencyContactName = "Pilar Vega";
    first.emergencyContactPhone = "+34 600 111 222";
    first.heldEmergencyContact = { name: "Rosa Vega", phone: "+34 600 333 444" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(row).toContain("Rosa Vega");
    expect(row).not.toContain("Pilar Vega");
  });

  it("shows no contact on a seat held by its blocker alone (H7)", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.emergencyContactName = "Pilar Vega";
    first.emergencyContactPhone = "+34 600 111 222";
    first.heldEmergencyContact = { name: "Rosa Vega", phone: "+34 600 333 444" };
    first.readiness = {
      status: "blocked",
      blockers: [{ code: "identity_unconfirmed", text: "Confirm who this is." }],
    };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(row).not.toContain("Pilar Vega");
    expect(row).not.toContain("Rosa Vega");
  });

  it("never shows a held seat's medical warnings", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.identityWithheld = true;
    first.medicalWarnings = { refusedOn: "2026-05-02" };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(row).not.toContain("physician");
    expect(row).not.toContain("Physician said no before");
  });

  /**
   * Layer 3 review (dde-1 F3): the desk saw this diver and turned them away.
   * The dock copy said "Not here", the opposite statement, to the one surface
   * at the rail with no signal.
   */
  it("says a seat the desk turned away was turned away, not not here", () => {
    const copy = savedCopy();
    const [first, second] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first || !second) throw new Error("fixture divers missing");
    first.notHere = true;
    first.turnedAway = true;
    second.notHere = true;
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const turnedAway = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(turnedAway).toContain("Turned away");
    expect(turnedAway).not.toContain("Not here");
    const notHere = container.querySelector("#offline-roll-call-b-marcus")?.textContent ?? "";
    expect(notHere).toContain("Not here");
    // The banner says "saved" once; no row repeats it (B01).
    expect(container.textContent).not.toContain("when saved");
  });

  /**
   * Issue #2960, H-153 amendment: the words only on a copy a permitted reader
   * saved with them, with who saved it and that nobody reviewed it; any other
   * copy says it was saved without them and who can save one that has them.
   */
  it("shows a medical alert's words on a copy saved with them, and says when a copy has none", () => {
    const alert = "Bee-sting allergy. EpiPen in the blue dry bag.";
    for (const [medicalAlert, words] of [
      [{ text: alert }, true],
      [{}, false],
    ] as const) {
      const copy = savedCopy();
      const [first] = copy.snapshot.manifests[0]?.divers ?? [];
      if (!first) throw new Error("fixture diver missing");
      first.medicalAlert = medicalAlert;
      if (words) {
        copy.medicalAlertsSavedBy = { personId: "p-yusra", name: "Yusra Idrissi", savedAt: "" };
      }
      const trip = offlineTripView(copy, "departure");
      if (!trip) throw new Error("the fixture carries a manifest");
      const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
      const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
      expect(row).toContain("Medical alert");
      if (words) {
        expect(row).toContain(alert);
        expect(row).toContain("Saved with the words by Yusra Idrissi.");
        expect(row).toContain("Nobody reviewed it, and it doesn’t change who can dive.");
      } else {
        expect(row).not.toContain(alert);
        expect(row).toContain("This copy was saved without the words.");
        // Never "only crew can read it" to a viewer who may be crew.
        expect(row).not.toContain("Only");
      }
      cleanup();
    }
  });

  it("shows no medical alert on a held seat", () => {
    const copy = savedCopy();
    const [first] = copy.snapshot.manifests[0]?.divers ?? [];
    if (!first) throw new Error("fixture diver missing");
    first.identityWithheld = true;
    first.medicalAlert = { text: "Bee-sting allergy." };
    const trip = offlineTripView(copy, "departure");
    if (!trip) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineDiverRollCall view={trip} controls={controls()} />);
    const row = container.querySelector("#offline-roll-call-b-priya")?.textContent ?? "";
    expect(row).not.toContain("Medical alert");
    expect(row).not.toContain("Bee-sting");
  });
});
