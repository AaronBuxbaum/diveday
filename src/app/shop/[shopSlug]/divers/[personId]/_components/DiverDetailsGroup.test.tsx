// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { DiverDetailsGroup } from "./DiverDetailsGroup";
import type { DiverProfile } from "./shared";

vi.mock("../details-actions", () => ({ savePersonAction: vi.fn() }));

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
  /** H-100: a split with no date filed a staffer's "18 or older" instead. */
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
    expect(document.body).not.toHaveTextContent("18 or older, per");
  });

  /** Issue #2553, Option A: a seat booked "Under 18" and no date on file. */
  it("asks for a date of birth while a seat ahead is booked as under 18", () => {
    const declared = diver("Ana Castellanos", "+13055550199");
    const props = {
      shopSlug: "blue-mantis",
      personId: "person-1",
      t,
      locale: "en-US",
      timezone: "America/New_York",
      country: "US",
    };
    const { container, getByText, rerender } = render(
      <DiverDetailsGroup {...props} diver={{ ...declared, minorDeclared: true }} />,
    );
    expect(
      getByText(
        "A booking says this diver is under 18, so their waiver needs a parent or guardian’s signature. Add the date of birth to settle it.",
      ),
    ).toBeInTheDocument();
    expect(getByText("Booked as under 18, no date on file")).toBeInTheDocument();
    expect(getByText("Emergency contact: Ana Castellanos")).toHaveClass("text-warning-strong");
    expect(container.querySelector("details")).toHaveAttribute("open");

    // A date on file is the answer: the prompt goes, whatever the seat says.
    rerender(
      <DiverDetailsGroup
        {...props}
        diver={{
          ...declared,
          minorDeclared: true,
          person: { ...declared.person, dateOfBirth: "2014-03-02" },
        }}
      />,
    );
    expect(document.body).not.toHaveTextContent("under 18");

    // No declared seat ahead: nothing to ask.
    rerender(<DiverDetailsGroup {...props} diver={{ ...declared, minorDeclared: false }} />);
    expect(document.body).not.toHaveTextContent("under 18");
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

  // Issue #2167: emptying a stored date takes "They're 18 or older" in the
  // same save, so the box is offered beside a date and refused on the field.
  it("offers the 18-or-older box only while a date is on file", () => {
    const props = {
      shopSlug: "blue-mantis",
      personId: "person-1",
      t,
      locale: "en-US",
      timezone: "America/New_York",
      country: "US",
    };
    const bare = diver(null);
    const { queryByLabelText, getByLabelText, rerender } = render(
      <DiverDetailsGroup {...props} diver={bare} />,
    );
    expect(queryByLabelText(/18 or older/)).toBeNull();

    rerender(
      <DiverDetailsGroup
        {...props}
        diver={{ ...bare, person: { ...bare.person, dateOfBirth: "1990-01-01" } }}
      />,
    );
    const box = getByLabelText("They’re 18 or older");
    expect(box).toHaveAttribute("name", "adultAttested");
    expect(box).not.toBeChecked();
  });

  // Dive-domain review of #2167: the box overrides the date it clears, so a
  // date that makes the diver a minor today is named on the box itself.
  it("names the age on file when the date makes the diver a minor", () => {
    const minor = diver(null);
    const { getByLabelText } = render(
      <DiverDetailsGroup
        shopSlug="blue-mantis"
        personId="person-1"
        t={t}
        locale="en-US"
        timezone="America/New_York"
        country="US"
        diver={{ ...minor, person: { ...minor.person, dateOfBirth: "2013-05-02" } }}
      />,
    );
    const box = getByLabelText(
      "They’re 18 or older. The date on file makes them 13. Ticking this says that date was wrong.",
    );
    expect(box).toHaveAttribute("name", "adultAttested");
  });

  it("puts a refused clear on the date field", () => {
    const status: GroupStatus = {
      form: "details",
      tone: "danger",
      text: "To clear the date of birth, select “They’re 18 or older”.",
      field: "diver-date-of-birth",
    };
    const { getByLabelText } = renderGroup({ open: true, status });
    const field = getByLabelText(/Date of birth/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(status.text);
  });
});
