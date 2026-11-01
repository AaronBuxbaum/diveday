// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";
import { DiverFacts } from "./DiverFacts";
import { diver, renderList, t } from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

/**
 * **A release standing over a referral nobody answered gets a row capsule
 * too** (dive-domain review of #2163), ranked just after the earlier refusal.
 *
 * The owner kept that override (2026-10-09, issue #2195, amending H-20261007-after-physician-says-no): the
 * diver boards, and the warning links back to the referral on screen. Paper
 * prints the same warning with nothing to tap.
 */
describe("an unanswered referral's warning", () => {
  const referredBefore = {
    at: new Date("2026-09-01T12:00:00.000Z"),
    source: "digital",
    overriddenReferralAt: new Date("2026-08-20T12:00:00.000Z"),
    overriddenReferral: {
      recordId: "w-referred",
      personId: "p-referred",
      at: new Date("2026-08-20T12:00:00.000Z"),
    },
    overriddenRefusal: null,
    clearance: null,
    guardian: null,
  } as unknown as TripManifest["divers"][number]["medicalWaiver"];

  it("links to the referral once, from the on-screen facts", () => {
    renderList({ divers: [diver({ medicalWaiver: referredBefore })] });
    // Paper carries the warning unlinked; the link is in the sheet.
    expect(screen.queryByRole("link", { name: "View the referral" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open details for Meera Iyer" }));

    const links = screen.getAllByRole("link", { name: "View the referral" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/p-referred/waivers/w-referred",
    );
    // The warning itself is printed on screen and on paper alike.
    expect(
      screen.getAllByText(/re-signed with no physician clearance on file/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("links the earlier refusal to its record from the on-screen facts, and paper stays unlinked", () => {
    const refusedBefore = {
      at: new Date("2026-09-01T12:00:00.000Z"),
      source: "digital",
      overriddenReferralAt: null,
      overriddenReferral: null,
      overriddenRefusal: {
        recordId: "w-refused",
        personId: "p-refused",
        at: new Date("2026-08-20T12:00:00.000Z"),
      },
      clearance: null,
      guardian: null,
    } as unknown as TripManifest["divers"][number]["medicalWaiver"];
    const { container } = renderList({ divers: [diver({ medicalWaiver: refusedBefore })] });
    const printed = container.querySelector<HTMLElement>(".hidden.print\\:block");
    expect(printed).toHaveTextContent(/A physician did not clear this person/);
    expect(within(printed as HTMLElement).queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "View the physician’s decision" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open details for Meera Iyer" }));
    const links = screen.getAllByRole("link", { name: "View the physician’s decision" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/p-refused/waivers/w-refused",
    );
    expect(screen.queryByRole("link", { name: "View the referral" })).toBeNull();
  });

  it("links neither warning on a held seat, whose medical history is the matched person's", () => {
    renderList({
      checkpoint: "departure",
      divers: [
        diver({
          identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
          readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
          medicalWaiver: {
            ...referredBefore,
            overriddenRefusal: {
              recordId: "w-refused",
              personId: "p-referred",
              at: new Date("2026-08-10T12:00:00.000Z"),
            },
          } as TripManifest["divers"][number]["medicalWaiver"],
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Open details for Maria" }));
    expect(screen.queryByRole("link", { name: "View the referral" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View the physician’s decision" })).toBeNull();
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/physician/);
  });

  it("draws no link for a release with no referral behind it", () => {
    renderList({ divers: [diver()] });
    fireEvent.click(screen.getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(screen.queryByRole("link", { name: "View the referral" })).toBeNull();
  });
});

/**
 * **A held seat prints the seat, not the matched person** (issue #1690,
 * H-20260916-unconfirmed-identity-withhold-cost). A walk-in tapped onto last season's "Maria Santos" must not carry her
 * next of kin, her daughter's age or her medical hold onto the boat under a
 * name nobody has confirmed: not on screen, and not on the printed sheet,
 * which is the half a screen-only test would miss.
 */
describe("a held seat on the manifest", () => {
  const heldSeat = (checkpoint: RollCallCheckpoint = "departure") =>
    renderList({
      checkpoint,
      divers: [
        diver({
          age: 13,
          minor: true,
          identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
          readiness: {
            status: "blocked",
            blockers: [{ code: "identity_unconfirmed" }, { code: "medical_review" }],
          },
          nitroxRequested: true,
          hotelPickupLocation: "Casa Marina",
        }),
      ],
    });

  it("withholds the contact, the age and the matched person's blockers, on paper too", () => {
    const { container } = heldSeat();
    const everything = container.textContent ?? "";
    expect(everything).not.toContain("Asha Iyer");
    expect(everything).not.toContain("+1-305-555-0231");
    expect(everything).not.toMatch(/age 13/);
    expect(everything).not.toContain(
      "A medical answer needs a doctor’s sign-off before this diver dives.",
    );
    // The print-only block says why, rather than "Not on file".
    const printed = container.querySelector<HTMLElement>(".print\\:block");
    expect(printed).not.toBeNull();
    expect(printed).toHaveTextContent(
      "Their contact, age and other details wait until the desk confirms who this is.",
    );
    expect(printed).not.toHaveTextContent("Not on file");
  });

  it("keeps the seat's own state: its name as booked, the blocked word and the pickup", () => {
    const { container } = heldSeat();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    // Named as booked; the matched person is not named at the rail.
    expect(container.textContent).toContain("Maria");
    expect(container.textContent).not.toContain("Meera Iyer");
    expect(container.textContent).toContain("Casa Marina");
  });

  /**
   * **A hold behind the identity question still reaches the rail** (dive-domain
   * review 2026-10-06). The crew line says the desk settles it and that other
   * holds may apply, never which: "medical" would be a fact about the matched
   * person, and "confirm who this is" on paper tells the crew to settle it.
   */
  it("flags other holds on a held seat with a medical hold, and never says medical", () => {
    const { container } = heldSeat();
    const crewLine =
      "Not confirmed. The desk must settle who this is before boarding. Other holds may still apply.";
    expect(container.textContent).toContain(crewLine);
    const printed = container.querySelector<HTMLElement>(".print\\:block");
    expect(printed).toHaveTextContent(crewLine);
    expect(container.textContent?.toLowerCase()).not.toContain("medical");
    expect(printed?.textContent?.toLowerCase()).not.toContain("medical");
    expect(container.textContent?.toLowerCase()).not.toContain("confirm who this is");
  });

  it("says nothing of other holds when the identity question is the only one", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
          readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
        }),
      ],
    });
    expect(container.textContent).toContain(
      "Not confirmed. The desk must settle who this is before boarding.",
    );
    expect(container.textContent).not.toContain("Other holds may still apply.");
  });

  it("says the same in the person's own panel", () => {
    heldSeat("after_dive_1");
    fireEvent.click(screen.getByRole("button", { name: "Open details for Maria" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Their contact, age and other details wait until the desk confirms who this is.",
    );
    expect(dialog).not.toHaveTextContent("Asha Iyer");
    expect(dialog).toHaveTextContent("Diver · not yet confirmed");
  });

  it("shows everything again once the desk has confirmed who this is", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          age: 13,
          minor: true,
          readiness: { status: "blocked", blockers: [{ code: "medical_review" }] },
        }),
      ],
    });
    const everything = container.textContent ?? "";
    expect(everything).toContain("Asha Iyer");
    expect(everything).toContain("+1-305-555-0231");
    expect(everything).toContain("Minor · age 13");
    expect(everything).toContain(
      "A medical answer needs a doctor’s sign-off before this diver dives.",
    );
    expect(everything).not.toContain("wait until the desk confirms");
  });

  it("says it in Spanish too", () => {
    const { container } = renderList({
      locale: "es-ES",
      checkpoint: "departure",
      divers: [
        diver({
          readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
        }),
      ],
    });
    expect(container.textContent).toContain(
      "Su contacto, su edad y sus demás datos esperan a que el mostrador confirme de quién se trata.",
    );
  });
});

describe("DiverFacts, drawn on its own", () => {
  it("prints the contact as one run on paper and keeps the number whole on screen", () => {
    const paper = render(
      <DiverFacts diver={diver()} locale="en-US" timezone="America/New_York" columns={2} t={t} />,
    );
    expect(paper.container.textContent).toContain("Asha Iyer · +1-305-555-0231");
    expect(paper.container.querySelector(".whitespace-nowrap")).toBeNull();
    paper.unmount();

    const screenFacts = render(
      <DiverFacts diver={diver()} locale="en-US" timezone="America/New_York" columns={1} t={t} />,
    );
    expect(screenFacts.container.querySelector(".whitespace-nowrap")).toHaveTextContent(
      "+1-305-555-0231",
    );
  });

  it("says a held seat's facts wait for confirmation instead of naming anybody's", () => {
    // As `withholdHeldSeatParticulars` hands it over: the matched record's
    // contact already cleared.
    render(
      <DiverFacts
        diver={diver({
          identityWithheld: true,
          emergencyContactName: null,
          emergencyContactPhone: null,
        })}
        locale="en-US"
        timezone="America/New_York"
        columns={2}
        t={t}
      />,
    );
    expect(screen.getByText(t("manifest.identityWithheldDetails"))).toBeInTheDocument();
    expect(screen.queryByText(/Asha Iyer/)).toBeNull();
  });

  it("prints the contact the desk recorded for a held seat, on paper too (issue 2145)", () => {
    render(
      <DiverFacts
        diver={diver({
          identityWithheld: true,
          emergencyContactName: null,
          emergencyContactPhone: null,
          heldEmergencyContact: { name: "Rosa Vega", phone: "+34 600 333 444" },
        })}
        locale="en-US"
        timezone="America/New_York"
        columns={2}
        t={t}
      />,
    );
    expect(screen.getByText(t("manifest.heldEmergencyContactLabel"))).toBeInTheDocument();
    expect(screen.getByText(/Rosa Vega/)).toBeInTheDocument();
    expect(screen.getByText(t("manifest.identityWithheldDetails"))).toBeInTheDocument();
  });

  it("prints nothing from the record's contact on a held seat, whatever reaches it (H7)", () => {
    render(
      <DiverFacts
        diver={diver({
          identityWithheld: true,
          emergencyContactName: "Pilar Vega",
          emergencyContactPhone: "+34 600 111 222",
        })}
        locale="en-US"
        timezone="America/New_York"
        columns={2}
        t={t}
      />,
    );
    expect(screen.queryByText(/Pilar Vega/)).toBeNull();
    expect(screen.queryByText(t("manifest.heldEmergencyContactLabel"))).toBeNull();
  });
});
