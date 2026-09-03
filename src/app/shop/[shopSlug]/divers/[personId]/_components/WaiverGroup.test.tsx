// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DiverProfile } from "./shared";
import { WaiverGroup } from "./WaiverGroup";

// Both server actions this group reaches for drag better-auth (and with it the
// whole Next server runtime) in behind them; this suite is about which controls
// the group offers, so they are stubbed rather than booted.
vi.mock("../actions", () => ({ markWaiverInPersonAction: vi.fn() }));
vi.mock("@/app/actions/waivers", () => ({ sendWaiversAction: vi.fn() }));

function diver(overrides: {
  email?: string | null;
  phone?: string | null;
  waiver?: DiverProfile["waiver"];
  waiverRequest?: DiverProfile["waiverRequest"];
  waiverChannels?: Partial<DiverProfile["waiverChannels"]>;
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
    waiverChannels: {
      email: "unknown",
      text: "unknown",
      link: "unknown",
      ...overrides.waiverChannels,
    },
  } as unknown as DiverProfile;
}

function renderCard(profile: DiverProfile, status?: ComponentProps<typeof WaiverGroup>["status"]) {
  return render(
    <WaiverGroup
      diver={profile}
      shopSlug="blue-mantis"
      personId="person-1"
      locale="en-US"
      t={staffTranslator("en-US")}
      timezone="America/Cancun"
      status={status}
    />,
  );
}

afterEach(cleanup);

describe("the waiver group", () => {
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

    expect(screen.getAllByText("Signed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark signed on paper" })).toBeNull();
  });

  /**
   * Each button wears what we last knew about *its own* channel. Before the
   * per-channel record existed there was one delivery status per link, so a
   * text send overwrote everything known about the email — and the row could
   * only ever have lit all three buttons the same way, or none.
   */
  it("marks each channel with its own last outcome, and leaves untried ones bare", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        phone: "+13055550142",
        waiverChannels: { email: "failed", text: "sent" },
      }),
    );

    expect(screen.getByRole("button", { name: /Email waiver/ }).textContent).toContain(
      "Didn’t go out",
    );
    expect(screen.getByRole("button", { name: /Text waiver/ }).textContent).toContain("Sent");
    // Nothing has been tried on the link, and "untried" is not a state worth a
    // mark on every unsigned waiver in the shop.
    expect(screen.getByRole("button", { name: "Copy link" }).textContent).toBe("Copy link");
  });

  /**
   * The outline is what a staffer sees across a counter, and it is colour. The
   * mark beside the label is the same fact in a *shape*, so the state never
   * rests on hue alone (design principle 6).
   */
  it("never carries a channel's state in colour alone", () => {
    renderCard(diver({ email: "priya@dive.day", waiverChannels: { email: "failed" } }));

    const button = screen.getByRole("button", { name: /Email waiver/ });
    expect(button.className).toContain("ring-danger");
    expect(button.querySelector("svg[aria-hidden='true'] path")).toBeTruthy();
    expect(button.textContent).toContain("Didn’t go out");
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
    } as ComponentProps<typeof WaiverGroup>["status"]);

    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record paper signature" })).toBeTruthy();
  });

  /**
   * The card said "Link sent" about a staffer taking the URL — a delivery
   * DiveDay never made and cannot see. Copying is its own outcome, and the two
   * must not share a sentence.
   */
  it("does not call a copied link a sent one", () => {
    renderCard(diver({ email: "priya@dive.day", waiverRequest: "link_copied" }));
    expect(screen.getByText("Link copied; not sent from here")).toBeTruthy();
    expect(screen.queryByText("Link sent; awaiting signature")).toBeNull();
  });

  it("still says sent when a message actually went out", () => {
    renderCard(diver({ email: "priya@dive.day", waiverRequest: "not_signed" }));
    expect(screen.getByText("Link sent; awaiting signature")).toBeTruthy();
  });

  it("leaves the form closed once the paper release has been recorded", () => {
    renderCard(diver({ email: "priya@dive.day" }), {
      form: "waiver",
      tone: "success",
      text: "Paper waiver recorded, signed and on file.",
    } as ComponentProps<typeof WaiverGroup>["status"]);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark signed on paper" })).toBeTruthy();
  });
});
