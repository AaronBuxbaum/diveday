// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import type { CardCredential } from "../credential-rows";
import { StaffCardCredentials } from "./StaffCardCredentials";

afterEach(cleanup);

/**
 * **The card names the credential a role is missing** (issue #2548). "None on
 * file" said nothing about a captain whose only card is first aid. A word,
 * never a gate (H-59).
 */
const t = staffTranslator("en-US");

function card(name: string, kind: string): CardCredential {
  return { id: `c-${kind}`, name, kind, renewalWord: null };
}

function renderCard(roles: Role[], credentials: CardCredential[]) {
  return render(
    <StaffCardCredentials
      personId="p1"
      roles={roles}
      credentials={credentials}
      locale="en-US"
      t={t}
    />,
  );
}

describe("StaffCardCredentials", () => {
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
    expect(screen.queryByText(/on file/)).toBeNull();
  });

  it("names each unanswered role of a person who holds two", () => {
    renderCard(["captain", "divemaster"], [card("PADI Divemaster", "divemaster_rating")]);
    expect(screen.getByText("No captain’s license on file")).toBeVisible();
  });

  it("draws no row for a role that sails on no card and has nothing recorded", () => {
    const { container } = renderCard(["owner"], []);
    expect(container).toBeEmptyDOMElement();
  });
});
