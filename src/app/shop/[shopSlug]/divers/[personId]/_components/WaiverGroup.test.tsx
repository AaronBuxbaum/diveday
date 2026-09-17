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
vi.mock("../actions", () => ({
  markWaiverInPersonAction: vi.fn(),
  recordMedicalClearanceAction: vi.fn(),
}));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: vi.fn(),
  undoHeldSendAction: vi.fn(),
  releaseHeldSendAction: vi.fn(),
}));

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

function renderCard(
  profile: DiverProfile,
  status?: ComponentProps<typeof WaiverGroup>["status"],
  canOpenClearance = false,
) {
  return render(
    <WaiverGroup
      diver={profile}
      shopSlug="blue-mantis"
      personId="person-1"
      locale="en-US"
      t={staffTranslator("en-US")}
      timezone="America/Cancun"
      canOpenClearance={canOpenClearance}
      status={status}
    />,
  );
}

afterEach(cleanup);

describe("the waiver group", () => {
  /**
   * The door's one fact is where the release stands **and until when** — the
   * standing alone left the reader with the question they opened the record to
   * answer. A state that has no date is already a whole sentence.
   */
  it("carries the standing and its date in the closed door", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        waiver: {
          state: "current",
          signedAt: new Date("2026-07-21T15:00:00.000Z"),
          expiresAt: new Date("2027-07-21T15:00:00.000Z"),
        } as DiverProfile["waiver"],
      }),
    );

    const door = screen.getByTestId("diver-file-group-waiver").querySelector("summary");
    expect(door).toHaveTextContent(/Signed · Good until Jul 21, 2027/);
    expect(screen.getByTestId("diver-file-group-waiver")).not.toHaveAttribute("open");
  });

  it("says only Not signed when nothing has been sent", () => {
    renderCard(diver({ email: "priya@dive.day" }));
    const door = screen.getByTestId("diver-file-group-waiver").querySelector("summary");
    expect(door).toHaveTextContent(/Waiver\s*Not signed$/);
  });

  /**
   * A medical hold is the one waiver state with an act only this group can
   * take — the physician's answer goes in here and nowhere else in the product
   * — so it is open work, and the record lands with the door open on it.
   */
  it("opens itself on a held medical review", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        waiver: {
          state: "medical_review",
          at: new Date("2026-09-02T15:00:00.000Z"),
        } as DiverProfile["waiver"],
      }),
    );

    expect(screen.getByTestId("diver-file-group-waiver")).toHaveAttribute("open");
    expect(
      screen.getByTestId("diver-file-group-waiver").querySelector("summary"),
    ).toHaveTextContent(/Medical review · Held since Sep 2, 2026/);
    expect(screen.getByRole("button", { name: /Record the physician’s answer/ })).toBeTruthy();
  });

  /**
   * **A referral the current signature replaced instead of answering** (issue
   * #1282). The standing is "Signed · Good until …" and the record is, on its
   * face, a clean one — so a closed muted door is the one way a staffer never
   * learns a physician was asked and never answered. The door says it, in
   * warning ink, and opens on it the way a held review does.
   */
  it("carries an unanswered referral on the closed door, and opens on it", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        waiver: {
          state: "current",
          signedAt: new Date("2026-07-21T15:00:00.000Z"),
          expiresAt: new Date("2027-07-21T15:00:00.000Z"),
          medical: {
            at: new Date("2026-07-21T15:00:00.000Z"),
            source: "cleared",
            overriddenReferralAt: new Date("2026-06-02T15:00:00.000Z"),
            clearance: null,
          },
        } as DiverProfile["waiver"],
      }),
    );

    const group = screen.getByTestId("diver-file-group-waiver");
    const door = group.querySelector("summary");
    expect(door).toHaveTextContent(
      /Signed · Good until Jul 21, 2027 · Referral on Jun 2, 2026 not answered/,
    );
    // Warning ink, because the summary stands on the diver's own second answer
    // rather than on anything the shop has seen.
    expect(door?.querySelector("span")?.className).toContain("text-warning-strong");
    expect(group).toHaveAttribute("open");
  });

  it("leaves a clean current release muted and shut", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        waiver: {
          state: "current",
          signedAt: new Date("2026-07-21T15:00:00.000Z"),
          expiresAt: new Date("2027-07-21T15:00:00.000Z"),
          medical: {
            at: new Date("2026-07-21T15:00:00.000Z"),
            source: "cleared",
            overriddenReferralAt: null,
            clearance: null,
          },
        } as DiverProfile["waiver"],
      }),
    );

    const group = screen.getByTestId("diver-file-group-waiver");
    expect(group.querySelector("summary")).not.toHaveTextContent(/not answered/);
    expect(group.querySelector("summary")?.querySelector("span")?.className).toContain(
      "text-muted",
    );
    expect(group).not.toHaveAttribute("open");
  });

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
   * **The door to the physician's evaluation** (issue #1283), and the two
   * reasons it is not drawn.
   *
   * The link is offered only when there is a file *and* this reader may open
   * it. A link that 404s for a divemaster teaches them the diver's record is
   * broken rather than that the document is not theirs to read — and the route
   * behind it answers 404 for exactly that caller, deliberately, so the two
   * would agree on the status and disagree on what it meant.
   */
  function clearedDiver(documentOnFile: boolean) {
    return diver({
      waiver: {
        state: "current",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        medical: {
          at: new Date("2026-05-01T00:00:00Z"),
          source: "cleared",
          overriddenReferralAt: null,
          clearance: { recordId: "record-1", documentOnFile },
        },
      } as DiverProfile["waiver"],
    });
  }

  it("offers the evaluation to a reader who may open it", () => {
    renderCard(clearedDiver(true), undefined, true);
    const link = screen.getByRole("link", { name: "Open the physician’s evaluation" });
    expect(link).toHaveAttribute("href", "/api/medical-clearances/record-1");
  });

  it("draws no door for a reader who may not open it", () => {
    renderCard(clearedDiver(true), undefined, false);
    expect(screen.queryByRole("link", { name: "Open the physician’s evaluation" })).toBeNull();
  });

  it("draws no door when the shop kept the paper instead of uploading it", () => {
    // A clearance evidenced by the physician's *name* is a complete record and
    // an ordinary one — there is simply no file, and an offer to open nothing
    // would read as a fault.
    renderCard(clearedDiver(false), undefined, true);
    expect(screen.queryByRole("link", { name: "Open the physician’s evaluation" })).toBeNull();
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
  // `getAllByText`: the group's closed door carries the same sentence as the
  // row inside it, which is what a door's summary *is* (the group's one useful
  // fact). What must not appear anywhere is the other sentence.
  it("does not call a copied link a sent one", () => {
    renderCard(diver({ email: "priya@dive.day", waiverRequest: "link_copied" }));
    expect(screen.getAllByText("Link copied; not sent from here").length).toBeGreaterThan(0);
    expect(screen.queryByText("Link sent; awaiting signature")).toBeNull();
  });

  it("still says sent when a message actually went out", () => {
    renderCard(diver({ email: "priya@dive.day", waiverRequest: "not_signed" }));
    expect(screen.getAllByText("Link sent; awaiting signature").length).toBeGreaterThan(0);
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

/**
 * **A minor's solo signature is a signed release** (ADR
 * 20260907-guardian-co-signature), so the record says what is actually missing.
 */
describe("a minor's release with no guardian on it", () => {
  const signedAt = new Date("2026-08-27T14:00:00.000Z");

  it("says what is missing rather than 'Not signed'", () => {
    renderCard(diver({ waiver: { state: "guardian_missing", signedAt } }));
    // Twice by design: the group's collapsed summary and the open row both
    // carry the state word.
    expect(screen.getAllByText("Guardian signature missing")).toHaveLength(2);
    expect(
      screen.getByText(
        "Signed Aug 27, 2026 by the diver alone; a parent or guardian still has to sign",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Not signed")).toBeNull();
    // The way out is the same as an expired release's: a fresh link.
    expect(screen.getByText("Send options", { exact: true })).toBeTruthy();
  });

  /**
   * The regression this was written for. A stale pending link makes
   * `waiverRequest` "failed", which deliberately overwrites the standing word —
   * because a failed *send* means the diver has not signed. It must not
   * overwrite this one: the diver signed, and the missing half is somebody
   * else's. The record read "Not signed" over its own line saying they had.
   */
  it("keeps its word when the last waiver message failed to send", () => {
    renderCard(diver({ waiver: { state: "guardian_missing", signedAt }, waiverRequest: "failed" }));
    expect(screen.getAllByText("Guardian signature missing")).toHaveLength(2);
    expect(screen.queryByText("Not signed")).toBeNull();
  });
});
