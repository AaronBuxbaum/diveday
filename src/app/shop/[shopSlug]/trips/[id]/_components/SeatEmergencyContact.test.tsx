// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { entry, noop } from "./roster-test-fixtures";
import { SeatEmergencyContact } from "./SeatEmergencyContact";

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderContact(hasEmergencyContact: boolean, held = false) {
  const { person } = entry("a", "Asha Osei");
  return render(
    <SeatEmergencyContact
      bookingId="a"
      contact={
        hasEmergencyContact
          ? { name: person.emergencyContactName, phone: person.emergencyContactPhone }
          : { name: null, phone: null }
      }
      held={held}
      holdOpen={false}
      t={t}
      saveEmergencyContactAction={noop}
    />,
  );
}

describe("SeatEmergencyContact", () => {
  it("states the contact on file, and offers to edit it", () => {
    renderContact(true);
    expect(
      screen.getByText(
        t("trips.roster.emergencyContactOnFile", { name: "Ada Contact", phone: "+1 555 0100" }),
      ),
    ).toBeTruthy();
    expect(screen.getByText(t("trips.roster.emergencyContactEdit"))).toBeTruthy();
  });

  it("names a held seat's contact as the seat's own (#2145)", () => {
    renderContact(false, true);
    expect(screen.getByText(t("trips.roster.heldEmergencyContactHeading"))).toBeTruthy();
    expect(screen.getByText(t("trips.roster.emergencyContactAddFull"))).toBeTruthy();
  });

  it("says a missing contact out loud, and offers to add one", () => {
    renderContact(false);
    expect(screen.getByText(t("trips.roster.emergencyContactMissing"))).toBeTruthy();
    expect(screen.getByText(t("trips.roster.emergencyContactAddFull"))).toBeTruthy();
  });
});
