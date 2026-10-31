// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import type { FormNotice } from "@/lib/staff-notices";
import type { CardCredential } from "../credential-rows";
import { TEAM_FORMS } from "../notices";
import { StaffCardCredentials } from "./StaffCardCredentials";

afterEach(cleanup);

/**
 * **The card names the credential a role is missing** (issue #2548). "None on
 * file" said nothing about a captain whose only card is first aid. A word,
 * never a gate (H-59).
 */
const t = staffTranslator("en-US");

function card(name: string, kind: string, extra: Partial<CardCredential> = {}): CardCredential {
  return { id: `c-${kind}`, name, kind, renewalWord: null, reviewed: true, ...extra };
}

const noop = () => {};

function renderCard(roles: Role[], credentials: CardCredential[], status?: FormNotice) {
  return render(
    <StaffCardCredentials
      personId="p1"
      roles={roles}
      credentials={credentials}
      locale="en-US"
      t={t}
      reviewAction={noop}
      deleteAction={noop}
      status={status}
    />,
  );
}

describe("StaffCardCredentials", () => {
  it("uses FormStatus's warning reveal without adding another sentinel", () => {
    const { container } = renderCard(["owner"], [], {
      form: TEAM_FORMS.credential("p1"),
      tone: "warning",
      text: "Needs review.",
    });
    const paragraph = screen.getByText("Needs review.").closest("p");
    if (!(paragraph instanceof HTMLElement)) throw new Error("Missing credential outcome");
    const sentinels = [...container.querySelectorAll<HTMLElement>("span[hidden]")];

    expect(sentinels).toHaveLength(1);
    expect(sentinels[0]?.previousElementSibling).toBe(paragraph);
  });

  it("keeps success in the fixed toast without adding a reveal helper", () => {
    const { container } = renderCard(["owner"], [], {
      form: TEAM_FORMS.credential("p1"),
      tone: "success",
      text: "Saved.",
    });
    const fixedToast = container.querySelector<HTMLElement>(".fixed");
    if (!fixedToast) throw new Error("Missing fixed success toast");
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(fixedToast).toHaveClass("fixed");
    expect(container.querySelector("span[hidden]")).toBeNull();
  });

  it("keeps danger with the field-focus path and does not mount a reveal helper", () => {
    const { container } = renderCard(["owner"], [], {
      form: TEAM_FORMS.credential("p1"),
      tone: "danger",
      text: "Could not save.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
    expect(container.querySelector("span[hidden]")).toBeNull();
  });

  it("says no credentials at all when a role that sails on a card has nothing", () => {
    renderCard(["captain"], []);
    expect(screen.getByText("No credentials on file")).toBeVisible();
  });

  it("names the captain's license a captain with only first aid lacks", () => {
    renderCard(["captain"], [card("EFR", "first_aid_cpr")]);
    expect(screen.getByText("No captain’s license on file")).toBeVisible();
    expect(screen.queryByText("No credentials on file")).toBeNull();
  });

  it("names the rating an instructor with only insurance lacks", () => {
    renderCard(["instructor"], [card("Policy", "liability_insurance")]);
    expect(screen.getByText("No instructor rating on file")).toBeVisible();
  });

  it("lists what is on file when the role is answered, and a higher rating answers a lower role", () => {
    renderCard(["divemaster"], [card("PADI Instructor", "instructor_rating")]);
    expect(screen.getAllByText("PADI Instructor").length).toBeGreaterThan(0);
    expect(screen.getByText("1 on file")).toBeVisible();
  });

  it("names each unanswered role of a person who holds two", () => {
    renderCard(["captain", "divemaster"], [card("PADI Divemaster", "divemaster_rating")]);
    expect(screen.getByText("No captain’s license on file")).toBeVisible();
  });

  it("counts settled credentials at rest and keeps complete long names inside", () => {
    const names = [
      "PADI Open Water Scuba Instructor — Professional Teaching Status",
      "Emergency First Response Primary and Secondary Care Instructor",
    ];
    const { container } = renderCard(
      ["instructor"],
      [card(names[0], "instructor_rating"), card(names[1], "first_aid_cpr")],
    );
    const summary = container.querySelector("summary");
    expect(summary).toHaveTextContent("Credentials");
    expect(summary).toHaveTextContent("2 on file");
    for (const name of names) {
      expect(summary).not.toHaveTextContent(name);
      expect(screen.getAllByText(name, { exact: true })).toHaveLength(1);
    }
  });

  it("keeps a due-soon warning and a role-critical missing qualification in the summary", () => {
    const { container } = renderCard(
      ["captain"],
      [card("EFR", "first_aid_cpr", { renewal: "due-soon", renewalWord: "Due soon" })],
    );
    expect(container.querySelector("summary")).toHaveTextContent("1 on file");
    expect(container.querySelector("summary")).toHaveTextContent("Due soon");
    expect(screen.getByText("No captain’s license on file")).toBeVisible();
  });

  it("adds a credential in this person's context", () => {
    renderCard(["captain"], []);
    expect(
      screen.getByRole("link", { name: t("staffing.credentials.add"), hidden: true }),
    ).toHaveAttribute("href", "?credentialFor=p1#add-credential");
  });

  it("is the ledger: an unreviewed credential says so and offers Mark reviewed and Delete", () => {
    renderCard(
      ["captain"],
      [
        card("USCG OUPV", "captains_licence", {
          reviewed: false,
          renewal: "overdue",
          renewalWord: "Expired",
        }),
      ],
    );
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByText("Expired")).toHaveClass("text-warning-strong");
  });

  it("offers no Mark reviewed once somebody has reviewed it, and Delete disables nothing", () => {
    renderCard(["captain"], [card("USCG OUPV", "captains_licence")]);
    expect(screen.queryByText("Needs review")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  /**
   * **What needs someone stands at rest** (dive-domain review, visual review
   * 2026-10-24): an expired or unreviewed credential is a row on the card, not
   * a line inside the closed disclosure; only in-date, reviewed ones fold.
   */
  it("shows an expired or unreviewed credential at rest and folds only the in-date ones", () => {
    renderCard(
      ["captain", "divemaster"],
      [
        card("USCG OUPV", "captains_licence", { renewal: "overdue", renewalWord: "Expired" }),
        card("EFR", "first_aid_cpr", { reviewed: false }),
        card("PADI Divemaster", "divemaster_rating", { renewal: "current" }),
      ],
    );
    expect(screen.getByText("Expired")).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeVisible();
    const rest = screen.getByRole("list", { name: "Credentials" });
    expect(rest).toHaveTextContent("USCG OUPV");
    expect(rest).toHaveTextContent("EFR");
    expect(rest).not.toHaveTextContent("PADI Divemaster");
    expect(rest.closest("details")).toBeNull();
  });

  it("takes a second, deliberate tap to delete a credential", () => {
    const deleteAction = vi.fn();
    render(
      <StaffCardCredentials
        personId="p1"
        roles={["captain"]}
        credentials={[card("USCG OUPV", "captains_licence", { reviewed: false })]}
        locale="en-US"
        t={t}
        reviewAction={noop}
        deleteAction={deleteAction}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Delete" });
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);
    expect(deleteAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete USCG OUPV?" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("draws no row for a role that sails on no card and has nothing recorded", () => {
    const { container } = renderCard(["owner"], []);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("renewing and correcting a staff credential", () => {
  it("opens the selected card with its current dates and separate save choices", () => {
    render(
      <StaffCardCredentials
        personId="p1"
        roles={["captain"]}
        locale="en-US"
        t={t}
        reviewAction={noop}
        deleteAction={noop}
        editAction={noop}
        credentials={[
          card("Licence", "captains_licence", {
            renewal: "overdue",
            revision: 4,
            issuedAt: "2024-01-01",
            renewsAt: "2026-01-01",
            identifier: "C-123",
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Edit or renew"));
    expect(screen.getByLabelText("Reference number")).toHaveValue("C-123");
    expect(screen.getByLabelText("Issue date")).toHaveValue("2024-01-01");
    expect(screen.getByLabelText("Renewal date")).toHaveValue("2026-01-01");
    expect(screen.getByRole("button", { name: "Save renewal" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save correction" })).toBeVisible();
  });
});
