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
  gap?: ComponentProps<typeof WaiverGroup>["gap"],
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
      gap={gap}
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

    // Nothing to send or record, so the group is a plain row: the fact is
    // the whole of it, and there is no door to open onto a copy of it.
    const row = screen.getByTestId("diver-file-group-waiver");
    expect(row).toHaveTextContent(/Signed · Good until Jul 21, 2027/);
    expect(row.querySelector("details")).toBeNull();
  });

  it("names a minor's co-signer on the plain row", () => {
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
            guardian: { name: "Jordan Guardian", relationship: "parent" },
          },
        } as DiverProfile["waiver"],
      }),
    );

    // The row has no door, so who signed it with them has to be on it.
    const row = screen.getByTestId("diver-file-group-waiver");
    expect(row).toHaveTextContent(
      /Good until Jul 21, 2027 · Co-signed by Jordan Guardian \(parent\)/,
    );
    expect(row.querySelector("details")).toBeNull();
  });

  /**
   * **The gap is said here, once** (`splitDiverStatus`). The status ledger
   * used to repeat "Waiver has not been sent" above this row; now the row
   * wears the consequence itself: danger ink, and the departure it blocks.
   * Its own "Not signed" already says what is wrong, so no second sentence.
   */
  it("wears a departure blocker in its own row: danger ink and the departure", () => {
    renderCard(diver({ email: "priya@dive.day" }), undefined, false, {
      kind: "waiver",
      tone: "danger",
      sentence: { blocker: { code: "waiver_not_sent" } },
      action: { labelKey: "divers.status.acts.sendWaiver", target: "send_waiver" },
      tripContext: {
        tripId: "trip-1",
        bookingId: "b1",
        startsAt: new Date("2026-10-09T11:30:00.000Z"),
      },
    });
    const door = screen.getByTestId("diver-file-group-waiver").querySelector("summary");
    expect(screen.getByText("Not signed")).toHaveClass("text-danger");
    expect(door).toHaveTextContent("Can’t board Fri, Oct 9 · 6:30 AM.");
    expect(door).not.toHaveTextContent("Waiver not signed. Not sent yet.");
  });

  it("says only Not signed when nothing has been sent", () => {
    renderCard(diver({ email: "priya@dive.day" }));
    const door = screen.getByTestId("diver-file-group-waiver").querySelector("summary");
    expect(door).toHaveTextContent(/Waiver\s*Not signed$/);
  });

  /**
   * **One status line, then the ways to fix it** (Aaron, 2026-10-03: "This is
   * quite confusing!"). The open group used to say "Not signed" under the
   * door's own "Not signed", add "Not sent", and hide the four routes behind a
   * "Send options" button. An unsigned release keeps the diver off the boat,
   * so the group opens on its own, onto the routes and nothing else.
   */
  it("opens an unsigned release straight onto the routes, without repeating the door", () => {
    renderCard(diver({ email: "priya@dive.day" }));
    expect(screen.getByTestId("diver-file-group-waiver")).toHaveAttribute("open");
    expect(screen.getAllByText("Not signed")).toHaveLength(1);
    expect(screen.queryByText("Not sent")).toBeNull();
    expect(screen.queryByText("Send options")).toBeNull();
    expect(screen.getByRole("button", { name: "Email waiver" })).toBeVisible();
  });

  it("gives the status ledger's Send the waiver a focusable place to land", () => {
    renderCard(diver({ email: "priya@dive.day" }));
    const anchor = document.getElementById("waiver-send");
    expect(anchor).toHaveAttribute("tabindex", "-1");
    expect(anchor).toContainElement(screen.getByRole("button", { name: "Copy link" }));
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
   * **Every row in the group keeps the state row's inset** (pixel-craft
   * class 5). The physician's form, the send options and the outcome line
   * padded themselves `py-3` where the state row above them pads `py-4`, so
   * the grey form sat 12px under its hairline and 12px over the card's edge
   * against 24px from its side. One spelling, `FILE_ROW_INSET`, for all.
   */
  it("insets every row it pads by hand the way the state row is inset", () => {
    const inset = (element: Element | null | undefined) =>
      [...(element?.classList ?? [])].filter((token) => /^(?:[\w-]+:)*p[xytb]-/.test(token));
    const rowOf = (element: Element) => {
      let row: Element | null = element;
      while (row?.parentElement && !row.parentElement.classList.contains("divide-y")) {
        row = row.parentElement;
      }
      return row;
    };

    // The physician's answer: a held review, the one state that offers it.
    const held = renderCard(
      diver({
        email: "priya@dive.day",
        waiver: {
          state: "medical_review",
          at: new Date("2026-09-02T15:00:00.000Z"),
        } as DiverProfile["waiver"],
      }),
    );
    const heldState = held.container.querySelector(".divide-y > :first-child");
    expect(inset(heldState)).toEqual(["px-5", "py-4", "sm:px-6"]);
    const clearance = rowOf(screen.getByRole("button", { name: /Record the physician’s answer/ }));
    expect(clearance).not.toBe(heldState);
    expect(inset(clearance)).toEqual(inset(heldState));
    cleanup();

    // The routes and a refusal's outcome line: an unsigned release, which
    // opens straight onto the routes with no state row above them.
    const unsigned = renderCard(diver({ email: "priya@dive.day" }), {
      form: "waiver",
      tone: "warning",
      text: "Confirm you reviewed the medical questionnaire before recording a paper waiver.",
    } as ComponentProps<typeof WaiverGroup>["status"]);
    const options = rowOf(screen.getByRole("button", { name: "Copy link" }));
    const outcome = rowOf(
      screen.getAllByText(/Confirm you reviewed the medical questionnaire/).at(-1) as Element,
    );
    expect(unsigned.container.querySelector(".divide-y > :first-child")).toBe(options);
    expect(outcome).not.toBe(options);
    expect(inset(options)).toEqual(inset(heldState));
    expect(inset(outcome)).toEqual(inset(heldState));
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

  it("keeps a physician's refusal behind a door, drawn as a refusal", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        waiver: {
          state: "medical_not_cleared",
          declinedAt: new Date("2026-07-21T15:00:00.000Z"),
          evaluation: null,
        } as unknown as DiverProfile["waiver"],
      }),
    );

    const group = screen.getByTestId("diver-file-group-waiver");
    // A disclosure, not the plain row a clean release gets: the state row
    // inside carries the danger ink the closed summary cannot.
    expect(group.tagName).toBe("DETAILS");
    expect(group.querySelector(".text-danger, .text-danger-strong")).not.toBeNull();
    // Danger and open on its own, with no departure to name: a physician's
    // "no" keeps the diver off every boat, whatever the caller passed.
    expect(group.querySelector("summary span.text-sm")?.className).toContain("text-danger");
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
    expect(group).not.toHaveTextContent(/not answered/);
    expect(group.querySelector("span.text-sm")?.className).toContain("text-muted");
    expect(group.querySelector("details")).toBeNull();
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

    expect(screen.getByTestId("diver-file-group-waiver")).toHaveTextContent(/Signed/);
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
   *
   * The outline is the button's own border, 2px in the state's hue (pixel-craft
   * class 6). It was a `ring-2` outside the grey border — two stacked edges —
   * and a ring takes no room, so a failed Email and a sent Text stood 4px apart
   * in a row whose plain buttons keep 8.
   */
  it("never carries a channel's state in colour alone", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        phone: "+13055550142",
        waiverChannels: { email: "failed", text: "sent" },
      }),
    );

    const button = screen.getByRole("button", { name: /Email waiver/ });
    expect(button).toHaveClass("border-2", "border-danger/55");
    expect(button).not.toHaveClass("border-border");
    expect(button.className).not.toMatch(/(^|\s|:)ring-/);
    expect(button.querySelector("svg[aria-hidden='true'] path")).toBeTruthy();
    expect(button.textContent).toContain("Didn’t go out");

    expect(screen.getByRole("button", { name: /Text waiver/ })).toHaveClass(
      "border-2",
      "border-success/50",
    );
    // Untried draws nothing: the plain hairline every secondary wears.
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveClass(
      "border",
      "border-border",
    );
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

  it("calls an expired release expired, and keeps a failed resend on the door", () => {
    renderCard(
      diver({
        email: "priya@dive.day",
        waiver: { state: "expired", signedAt: new Date("2025-08-27T14:00:00.000Z") },
        waiverRequest: "failed",
      } as Parameters<typeof diver>[0]),
    );
    const door = screen.getByTestId("diver-file-group-waiver").querySelector("summary");
    expect(door).not.toHaveTextContent("Not signed");
    expect(door).toHaveTextContent(/Last signed Aug 27, 2025/);
    expect(door).toHaveTextContent("Failed to deliver");
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
    // Once, on the door: the open group carries only the sentence the door
    // does not, and the ways out.
    expect(screen.getAllByText("Guardian signature missing")).toHaveLength(1);
    expect(
      screen.getByText(
        "Signed Aug 27, 2026 by the diver alone; a parent or guardian still has to sign",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Not signed")).toBeNull();
    // The way out is the same as an expired release's: a fresh link.
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
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
    expect(screen.getAllByText("Guardian signature missing")).toHaveLength(1);
    expect(screen.queryByText("Not signed")).toBeNull();
  });
});
