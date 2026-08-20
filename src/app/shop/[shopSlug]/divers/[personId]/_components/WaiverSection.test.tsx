// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverProfile } from "./shared";
import { WaiverSection } from "./WaiverSection";

// Both server actions this card reaches for drag next-auth (and with it the
// whole Next server runtime) in behind them; this suite is about which controls
// the card offers, so they are stubbed rather than booted.
vi.mock("../actions", () => ({ markWaiverInPersonAction: vi.fn() }));
vi.mock("@/app/actions/waivers", () => ({ sendWaiversAction: vi.fn() }));

function diver(overrides: {
  email?: string | null;
  phone?: string | null;
  waiver?: DiverProfile["waiver"];
  waiverRequest?: DiverProfile["waiverRequest"];
}): DiverProfile {
  return {
    person: {
      id: "person-1",
      fullName: "Priya Sharma",
      email: overrides.email ?? null,
      phone: overrides.phone ?? null,
    },
    waiver: overrides.waiver ?? { state: "none" },
    waiverRequest: overrides.waiverRequest ?? "not_sent",
  } as unknown as DiverProfile;
}

function renderCard(
  profile: DiverProfile,
  status?: ComponentProps<typeof WaiverSection>["status"],
) {
  return render(
    <WaiverSection
      diver={profile}
      shopSlug="blue-mantis"
      personId="person-1"
      locale="en-US"
      timezone="America/Cancun"
      status={status}
    />,
  );
}

afterEach(cleanup);

describe("WaiverSection", () => {
  it("offers every route a staffer could take, and only the ones the record supports", () => {
    renderCard(diver({ email: "priya@dive.day", phone: "+13055550142" }));

    expect(screen.getByRole("button", { name: "Email waiver" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Text waiver" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark signed on paper" })).toBeTruthy();
  });

  it("drops the email button for a diver with no address on file", () => {
    renderCard(diver({ phone: "+13055550142" }));

    expect(screen.queryByRole("button", { name: "Email waiver" })).toBeNull();
    expect(screen.getByRole("button", { name: "Text waiver" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  /**
   * A local number is not a textable one: `smsRecipient` refuses anything
   * without an unambiguous country code, so a button offering to text it could
   * only ever come back "no number we can text". The card asks the same question
   * the send does rather than settling for "the field is non-empty".
   */
  it("drops the text button for a number that cannot be dialed internationally", () => {
    renderCard(diver({ email: "priya@dive.day", phone: "555-0142" }));

    expect(screen.queryByRole("button", { name: "Text waiver" })).toBeNull();
    expect(screen.getByRole("button", { name: "Email waiver" })).toBeTruthy();
  });

  it("keeps the link and the paper attestation for a diver with no contact details at all", () => {
    renderCard(diver({}));

    expect(screen.queryByRole("button", { name: "Email waiver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Text waiver" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark signed on paper" })).toBeTruthy();
  });

  /**
   * A current signature has nothing to send — `issueWaiverRequest` refuses it as
   * `already_completed` — so offering four buttons that each answer "they
   * already signed" would be four dead controls on a card whose whole job is to
   * say the diver is covered.
   */
  it("offers nothing to a diver whose release is current", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        phone: "+13055550142",
        waiver: {
          state: "current",
          expiresAt: new Date("2027-01-01T00:00:00Z"),
        } as DiverProfile["waiver"],
      }),
    );

    expect(screen.getByText("Signed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark signed on paper" })).toBeNull();
  });

  /**
   * The medical attestation is the control, not a buried confirm — the same
   * guarantee `recordInPersonWaiver` enforces server-side. Opening the paper
   * form must always land on a checkbox naming what the staffer is asserting.
   */
  it("puts the medical attestation in front of the staffer before recording paper", () => {
    renderCard(diver({ email: "priya@dive.day" }));

    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark signed on paper" }));

    const attestation = screen.getByRole("checkbox");
    expect(attestation.getAttribute("required")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Record paper signature" })).toBeTruthy();
  });

  /**
   * The refusal for a missing attestation is toned `warning`, not `danger` — it
   * is a step the staffer skipped, not something that broke — so "re-open on a
   * danger notice" left the form collapsed over its own error and the staffer
   * had to find the trigger again to tick one box. Any non-success notice on
   * this card is one of the two refusals the action can produce.
   */
  it("comes back with the attestation form still standing after a refusal", () => {
    renderCard(diver({ email: "priya@dive.day" }), {
      form: "waiver",
      tone: "warning",
      text: "Confirm you reviewed the medical questionnaire before recording a paper waiver.",
    } as ComponentProps<typeof WaiverSection>["status"]);

    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record paper signature" })).toBeTruthy();
  });

  it("leaves the form closed once the paper release has been recorded", () => {
    renderCard(diver({ email: "priya@dive.day" }), {
      form: "waiver",
      tone: "success",
      text: "Paper waiver recorded — signed and on file.",
    } as ComponentProps<typeof WaiverSection>["status"]);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark signed on paper" })).toBeTruthy();
  });
});
