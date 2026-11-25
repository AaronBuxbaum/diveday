// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { keptTypedKey } from "@/components/KeepTypedOnRefusal";
import { PARTY_FORM, partyMemberField } from "@/lib/seat-party-form";
import { PartyRows } from "./PartyRows";

const SCOPE = "blue-mantis.p-desk";

const COPY = {
  add: "Add another person",
  person: "Person {n}",
  name: "Full name",
  email: "Email",
  phone: "Phone",
  remove: "Remove",
  removeFor: "Remove person {n}",
  extras: {
    comingAs: "Coming as",
    types: { diver: "Diver", snorkeler: "Snorkeler", rider: "Rider" },
    under18: "Under 18",
    under18Hint: "A parent or legal guardian signs the release with them.",
    dob: "Date of birth",
    dobHint: "Optional. It sets a junior diver’s depth limit.",
  },
};

function renderRows(restore: boolean) {
  return render(
    <form>
      <PartyRows copy={COPY} keptScope={SCOPE} restore={restore} dobMax="2026-10-17" />
    </form>,
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("PartyRows", () => {
  it("asks each person what they are coming as, defaulting to Diver", async () => {
    renderRows(false);
    await userEvent.click(screen.getByRole("button", { name: "Add another person" }));
    expect(screen.getByRole("combobox", { name: "Coming as" })).toHaveValue("diver");
  });

  it("asks each person for their own optional email and phone", async () => {
    const { container } = renderRows(false);
    await userEvent.click(screen.getByRole("button", { name: "Add another person" }));
    const email = screen.getByRole("textbox", { name: "Email" });
    const phone = screen.getByRole("textbox", { name: "Phone" });
    expect(email).toHaveAttribute("name", partyMemberField(1, "email"));
    expect(email).toHaveAttribute("type", "email");
    expect(email).not.toBeRequired();
    expect(phone).toHaveAttribute("name", partyMemberField(1, "phone"));
    expect(phone).not.toBeRequired();
    // A name is still the only thing a row needs.
    expect(container.querySelector('[name="member-1-name"]')).toBeRequired();
  });

  it("asks for a date of birth only once Under 18 is ticked", async () => {
    renderRows(false);
    await userEvent.click(screen.getByRole("button", { name: "Add another person" }));
    const dob = screen.getByLabelText(/Date of birth/);
    expect(dob).not.toBeVisible();
    await userEvent.click(screen.getByRole("checkbox", { name: /Under 18/ }));
    expect(dob).toBeVisible();
    expect(dob).toHaveAttribute("max", "2026-10-17");
  });

  it("puts each tick and type back on the same name after a refusal", async () => {
    window.sessionStorage.setItem(
      keptTypedKey(PARTY_FORM, SCOPE),
      JSON.stringify({
        at: Date.now(),
        fields: {
          [partyMemberField(1, "name")]: "Mia Lopez",
          [partyMemberField(1, "type")]: "snorkeler",
          [partyMemberField(1, "phone")]: "+1 305 555 0142",
          [partyMemberField(3, "name")]: "Leo Lopez",
          [partyMemberField(3, "email")]: "leo@lopez.test",
          [partyMemberField(3, "minor")]: "true",
          [partyMemberField(3, "dob")]: "2014-05-06",
        },
      }),
    );
    const { container } = renderRows(true);
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('[name="member-3-name"]')?.value).toBe(
        "Leo Lopez",
      ),
    );
    const field = (name: string) =>
      container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
    expect(field(partyMemberField(1, "name"))?.value).toBe("Mia Lopez");
    expect(field(partyMemberField(1, "phone"))?.value).toBe("+1 305 555 0142");
    expect(field(partyMemberField(3, "email"))?.value).toBe("leo@lopez.test");
    expect((field(partyMemberField(1, "minor")) as HTMLInputElement).checked).toBe(false);
    expect(field(partyMemberField(1, "type"))?.value).toBe("snorkeler");
    expect((field(partyMemberField(3, "minor")) as HTMLInputElement).checked).toBe(true);
    expect(field(partyMemberField(3, "dob"))?.value).toBe("2014-05-06");
    expect(field(partyMemberField(3, "dob"))).toBeVisible();
    expect(field(partyMemberField(3, "type"))?.value).toBe("diver");
  });
});
