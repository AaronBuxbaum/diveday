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
  gap,
}: {
  emergency?: string | null;
  emergencyPhone?: string | null;
  open?: boolean;
  status?: GroupStatus;
  gap?: ComponentProps<typeof DiverDetailsGroup>["gap"];
} = {}) {
  return render(
    <DiverDetailsGroup
      diver={diver(emergency, emergencyPhone)}
      shopSlug="blue-mantis"
      personId="person-1"
      t={t}
      locale="en-US"
      timezone="America/New_York"
      country="US"
      open={open}
      status={status}
      gap={gap}
    />,
  );
}

/**
 * **Contact details are a file group, not a second button** (ADR
 * 20261001-logbook, decision 2), and the one place a missing contact is named:
 * the status ledger no longer says it above this row (`splitDiverStatus`).
 */
describe("DiverDetailsGroup", () => {
  /** H-99: a split with no date filed a staffer's "18 or older" instead. */
  it("says who answered 18 or older where no date of birth is on file", () => {
    const attested = diver(null);
    const props = {
      shopSlug: "blue-mantis",
      personId: "person-1",
      t,
      locale: "en-US",
      timezone: "America/New_York",
      country: "US",
    };
    const { getByText, rerender } = render(
      <DiverDetailsGroup
        {...props}
        diver={{
          ...attested,
          person: { ...attested.person, adultAttestedAt: new Date("2026-10-06T15:00:00Z") },
          adultAttestedByName: "Dana Reyes",
        }}
      />,
    );
    expect(getByText("18 or older, per Dana Reyes")).toBeInTheDocument();

    // A date, once typed, is the answer; the hint goes back to optional.
    rerender(
      <DiverDetailsGroup
        {...props}
        diver={{
          ...attested,
          person: {
            ...attested.person,
            dateOfBirth: "1990-04-02",
            adultAttestedAt: new Date("2026-10-06T15:00:00Z"),
          },
          adultAttestedByName: "Dana Reyes",
        }}
      />,
    );
    expect(document.body).not.toHaveTextContent("18 or older");
  });

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

  // Issue #2073: a diver under a departure's minimum age showed nothing on
  // their record. The contact summary cannot say it, so the gap does, with
  // the boat it keeps them off, and the door opens on it.
  it("says an age under a departure's minimum, and opens on it", () => {
    const { container } = renderGroup({
      emergency: "Ana Castellanos",
      emergencyPhone: "+13055550199",
      gap: {
        kind: "contact",
        tone: "danger",
        sentence: { blocker: { code: "under_minimum_age", params: { age: 13, minimumAge: 15 } } },
        action: { labelKey: "divers.status.acts.editContact", target: "edit_contact" },
        tripContext: {
          tripId: "trip-1",
          bookingId: "booking-1",
          startsAt: new Date("2026-10-10T12:00:00Z"),
        },
      },
    });
    const details = container.querySelector("details");
    expect(details).toHaveAttribute("open");
    expect(details).toHaveTextContent(/15/);
    expect(details).toHaveTextContent(/Can’t board/);
  });
});
