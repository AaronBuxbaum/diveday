// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { DiverDetailsGroup } from "./DiverDetailsGroup";
import type { DiverProfile } from "./shared";

vi.mock("../actions", () => ({ savePersonAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
type GroupStatus = ComponentProps<typeof DiverDetailsGroup>["status"];

function diver(
  emergencyContactName: string | null,
  emergencyContactPhone: string | null = null,
): DiverProfile {
  return {
    person: {
      id: "person-1",
      fullName: "Mira Castellanos",
      email: "mira@example.test",
      phone: "+13055550142",
      diveInsurance: null,
      dateOfBirth: null,
      emergencyContactName,
      emergencyContactPhone,
      deletedAt: null,
    },
  } as unknown as DiverProfile;
}

function renderGroup({
  emergency = null,
  emergencyPhone = null,
  open = false,
  status,
}: {
  emergency?: string | null;
  emergencyPhone?: string | null;
  open?: boolean;
  status?: GroupStatus;
} = {}) {
  return render(
    <DiverDetailsGroup
      diver={diver(emergency, emergencyPhone)}
      shopSlug="blue-mantis"
      personId="person-1"
      t={t}
      locale="en-US"
      country="US"
      open={open}
      status={status}
    />,
  );
}

/**
 * **Contact details are a file group, not a second button** (ADR
 * 20261001-logbook, decision 2), and the one place a missing contact is named:
 * the status ledger no longer says it above this row (`splitDiverStatus`).
 */
describe("DiverDetailsGroup", () => {
  it("is a closed door that names a missing contact in warning ink", () => {
    const { container, getByText } = renderGroup();
    const details = container.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    expect(container.querySelector("#edit-details")).toHaveTextContent("Contact details");
    expect(getByText("No emergency contact")).toHaveClass("text-warning-strong");
    expect(details?.querySelector("form")).not.toBeNull();
  });

  it("names the emergency contact when there is one", () => {
    const { getByText, queryByText } = renderGroup({
      emergency: "Ana Castellanos",
      emergencyPhone: "+13055550199",
    });
    expect(getByText("Emergency contact: Ana Castellanos")).toHaveClass("text-muted");
    expect(queryByText("No emergency contact")).toBeNull();
  });

  // "On file" needs a name and a number (glossary — Emergency contact): a name
  // alone is still the gap, and the row says which half is missing.
  it("says a contact with no number is half there", () => {
    const { getByText } = renderGroup({ emergency: "Ana Castellanos" });
    expect(getByText("Emergency contact: Ana Castellanos, no phone number")).toHaveClass(
      "text-warning-strong",
    );
  });

  it("opens for a refused save and keeps the refusal with the form", () => {
    const status: GroupStatus = {
      form: "details",
      tone: "danger",
      text: "Could not save the diver details.",
    };
    const { container, getByRole } = renderGroup({ open: true, status });
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(getByRole("alert")).toHaveTextContent(status.text);
  });
});
