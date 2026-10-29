// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KeepTypedOnRefusal, keptTypedKey } from "@/components/KeepTypedOnRefusal";
import { staffTranslator } from "@/i18n/staff-messages";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { BoatPaperFields } from "./BoatPaperFields";

const SCOPE = "blue-mantis.p-desk";
const STORAGE_KEY = keptTypedKey("boats-add", SCOPE);
const DRAFT = {
  name: "Dock test",
  capacity: "10",
  certifiedPassengers: "10",
  certifiedTotalPersons: "12",
  coiExpiresOn: "2026-10-20",
  inspectionDueOn: "2027-01-01",
  registrationExpiresOn: "2026-10-19",
  insuranceExpiresOn: "2026-10-18",
  workingChannel: "16",
};

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function BoatForm({ restore, scope = SCOPE }: { restore: boolean; scope?: string }) {
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <label>
        Name
        <input name="name" />
      </label>
      <label>
        Capacity
        <input name="capacity" type="number" />
      </label>
      <BoatPaperFields t={staffTranslator("en-US")} />
      <input name="cardNumber" />
      <input name="cardExpiresOn" />
      <input name="medicalAnswers" />
      <input name="secretToken" />
      <KeepTypedOnRefusal
        form="boats-add"
        scope={scope}
        restore={restore}
        policy="boat-paper-dates"
      />
    </form>
  );
}

function field(container: HTMLElement, name: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(`Missing boat field ${name}`);
  return input;
}

function fill(container: HTMLElement, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.input(field(container, name), { target: { value } });
  }
}

function submitAndReset(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("Missing boat form");
  fireEvent.submit(form);
  act(() => form.reset());
}

function expectValues(container: HTMLElement, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    expect(field(container, name).value, name).toBe(value);
  }
}

describe("boat paper date refusal drafts", () => {
  it("does not apply the boat policy under another form key", () => {
    const { container } = render(
      <form>
        <input name="coiExpiresOn" defaultValue="2027-01-01" />
        <KeepTypedOnRefusal
          form="unrelated-form"
          scope={SCOPE}
          restore={false}
          policy="boat-paper-dates"
        />
      </form>,
    );
    submitAndReset(container);
    const stored = window.sessionStorage.getItem(keptTypedKey("unrelated-form", SCOPE));
    expect(stored).not.toContain("coiExpiresOn");
    expect(stored).not.toContain("2027-01-01");
  });

  it("restores all three paper expiry dates with the inspection and boat facts", () => {
    const { container, rerender } = render(<BoatForm restore={false} />);
    fill(container, DRAFT);
    submitAndReset(container);
    expect(field(container, "coiExpiresOn").value).toBe("");

    rerender(<BoatForm restore />);
    expectValues(container, DRAFT);
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing boat form");
    const submitted = new FormData(form);
    for (const [name, value] of Object.entries(DRAFT)) expect(submitted.get(name)).toBe(value);
  });

  it("keeps corrected and deliberately cleared dates after repeat refusal and late reset", async () => {
    const { container, rerender } = render(<BoatForm restore={false} />);
    fill(container, DRAFT);
    submitAndReset(container);
    rerender(<BoatForm restore />);

    const corrected = {
      ...DRAFT,
      coiExpiresOn: "2027-02-03",
      registrationExpiresOn: "2027-03-04",
      insuranceExpiresOn: "",
      workingChannel: "70",
    };
    fill(container, corrected);
    submitAndReset(container);
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expectValues(container, corrected);

    const form = container.querySelector("form");
    if (!form) throw new Error("Missing boat form");
    act(() => form.reset());
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expectValues(container, corrected);
  });

  it("keeps the exact boat dates while excluding payment details, medical answers and secrets", () => {
    const { container, rerender } = render(<BoatForm restore={false} />);
    fill(container, DRAFT);
    const sensitive = {
      cardNumber: "4242424242424242",
      cardExpiresOn: "11/30",
      medicalAnswers: "private medical answer",
      secretToken: "private credential",
    };
    fill(container, sensitive);
    submitAndReset(container);
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    for (const [name, value] of Object.entries(sensitive)) {
      expect(stored).not.toContain(name);
      expect(stored).not.toContain(value);
    }
    for (const name of ["coiExpiresOn", "registrationExpiresOn", "insuranceExpiresOn"])
      expect(stored).toContain(`"${name}"`);
    rerender(<BoatForm restore />);
    expectValues(container, DRAFT);
    for (const name of Object.keys(sensitive)) expect(field(container, name).value).toBe("");
  });

  it("does not restore dates across staff, shops or the shared ten-minute lifetime", () => {
    const { container } = render(<BoatForm restore={false} />);
    fill(container, DRAFT);
    submitAndReset(container);
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (!saved) throw new Error("Missing retained boat draft");
    for (const scope of ["blue-mantis.p-other", "other-shop.p-desk"]) {
      cleanup();
      const next = render(<BoatForm restore scope={scope} />);
      expect(field(next.container, "coiExpiresOn").value).toBe("");
      expect(field(next.container, "registrationExpiresOn").value).toBe("");
      expect(field(next.container, "insuranceExpiresOn").value).toBe("");
    }
    cleanup();
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...JSON.parse(saved), at: nowMs() - 11 * MINUTE_MS }),
    );
    const expired = render(<BoatForm restore />);
    expect(field(expired.container, "coiExpiresOn").value).toBe("");
    expect(field(expired.container, "registrationExpiresOn").value).toBe("");
    expect(field(expired.container, "insuranceExpiresOn").value).toBe("");
  });

  it("forgets the boat dates with the other fields after a refusal is resolved", () => {
    const { container, rerender } = render(<BoatForm restore={false} />);
    fill(container, DRAFT);
    submitAndReset(container);
    rerender(<BoatForm restore />);
    expectValues(container, DRAFT);
    rerender(<BoatForm restore={false} />);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
