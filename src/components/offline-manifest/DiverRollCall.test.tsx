// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineDiverRollCall } from "./DiverRollCall";
import { controls, savedCopy, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

describe("OfflineDiverRollCall", () => {
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
    expect(turnedAway).toContain("Turned away when saved");
    expect(turnedAway).not.toContain("Not here when saved");
    const notHere = container.querySelector("#offline-roll-call-b-marcus")?.textContent ?? "";
    expect(notHere).toContain("Not here when saved");
  });
});
