// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { keptTypedKey } from "@/components/KeepTypedOnRefusal";
import { WALK_IN_PARTY_FORM, walkInMemberField } from "@/lib/walk-in-party";
import { WalkInPartyRows } from "./WalkInPartyRows";

const SCOPE = "blue-mantis.p-desk";

const COPY = {
  add: "Add another person",
  person: "Person {n}",
  name: "Full name",
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
      <WalkInPartyRows copy={COPY} keptScope={SCOPE} restore={restore} dobMax="2026-10-17" />
    </form>,
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("WalkInPartyRows", () => {
  it("asks each person what they are coming as, defaulting to Diver", async () => {
    renderRows(false);
    await userEvent.click(screen.getByRole("button", { name: "Add another person" }));
    expect(screen.getByRole("combobox", { name: "Coming as" })).toHaveValue("diver");
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
      keptTypedKey(WALK_IN_PARTY_FORM, SCOPE),
      JSON.stringify({
        at: Date.now(),
        fields: {
          [walkInMemberField(1, "name")]: "Mia Lopez",
          [walkInMemberField(1, "type")]: "snorkeler",
          [walkInMemberField(3, "name")]: "Leo Lopez",
          [walkInMemberField(3, "minor")]: "true",
          [walkInMemberField(3, "dob")]: "2014-05-06",
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
    expect(field(walkInMemberField(1, "name"))?.value).toBe("Mia Lopez");
    expect((field(walkInMemberField(1, "minor")) as HTMLInputElement).checked).toBe(false);
    expect(field(walkInMemberField(1, "type"))?.value).toBe("snorkeler");
    expect((field(walkInMemberField(3, "minor")) as HTMLInputElement).checked).toBe(true);
    expect(field(walkInMemberField(3, "dob"))?.value).toBe("2014-05-06");
    expect(field(walkInMemberField(3, "dob"))).toBeVisible();
    expect(field(walkInMemberField(3, "type"))?.value).toBe("diver");
  });
});
