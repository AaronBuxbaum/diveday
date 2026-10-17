// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { forgetAllKeptTyped, KeepTypedOnRefusal, keptTypedKey } from "./KeepTypedOnRefusal";

const SCOPE = "blue-mantis.p-desk";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function GearForm({ restore, scope = SCOPE }: { restore: boolean; scope?: string }) {
  return (
    <form data-testid="form" onSubmit={(event) => event.preventDefault()}>
      <input name="label" defaultValue="" />
      <input name="serialNumber" defaultValue="" />
      <textarea name="reportedProblem" defaultValue="" />
      <input name="cardNumber" defaultValue="" />
      <KeepTypedOnRefusal form="gear-add-unit" scope={scope} restore={restore} />
    </form>
  );
}

function field(container: HTMLElement, name: string) {
  return container.querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;
}

function typeAndSubmit(container: HTMLElement) {
  field(container, "label").value = "BCD-07";
  field(container, "serialNumber").value = "SN-4471";
  field(container, "reportedProblem").value = "Inflator sticks on the second press.";
  field(container, "cardNumber").value = "4242424242424242";
  const form = container.querySelector("form") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  form.reset();
}

describe("KeepTypedOnRefusal", () => {
  it("puts back what was typed when the page comes back refused", () => {
    const { container, rerender } = render(<GearForm restore={false} />);
    typeAndSubmit(container);
    expect(field(container, "serialNumber").value).toBe("");
    rerender(<GearForm restore />);
    expect(field(container, "label").value).toBe("BCD-07");
    expect(field(container, "serialNumber").value).toBe("SN-4471");
    expect(field(container, "reportedProblem").value).toBe("Inflator sticks on the second press.");
  });

  it("never keeps a field on the draft never-list", () => {
    const { container, rerender } = render(<GearForm restore={false} />);
    typeAndSubmit(container);
    expect(window.sessionStorage.getItem(keptTypedKey("gear-add-unit", SCOPE))).not.toContain(
      "4242",
    );
    rerender(<GearForm restore />);
    expect(field(container, "cardNumber").value).toBe("");
  });

  it("puts them back again after React clears the form on a repeated refusal", async () => {
    const { container, rerender } = render(<GearForm restore={false} />);
    typeAndSubmit(container);
    rerender(<GearForm restore />);
    const form = container.querySelector("form") as HTMLFormElement;
    form.reset();
    expect(field(container, "serialNumber").value).toBe("");
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(field(container, "serialNumber").value).toBe("SN-4471");
  });

  it("forgets them on any other answer", () => {
    const { container } = render(<GearForm restore={false} />);
    typeAndSubmit(container);
    expect(window.sessionStorage.getItem(keptTypedKey("gear-add-unit", SCOPE))).not.toBeNull();
    cleanup();
    render(<GearForm restore={false} />);
    expect(window.sessionStorage.getItem(keptTypedKey("gear-add-unit", SCOPE))).toBeNull();
  });

  it("keeps them for one shop and one staffer, so the next one on the tab sees none", () => {
    const { container } = render(<GearForm restore={false} />);
    typeAndSubmit(container);
    cleanup();
    const next = render(<GearForm restore scope="blue-mantis.p-other" />);
    expect(field(next.container, "serialNumber").value).toBe("");
  });

  it("drops what was kept more than ten minutes ago", () => {
    window.sessionStorage.setItem(
      keptTypedKey("gear-add-unit", SCOPE),
      JSON.stringify({ at: nowMs() - 11 * MINUTE_MS, fields: { serialNumber: "SN-4471" } }),
    );
    const { container } = render(<GearForm restore />);
    expect(field(container, "serialNumber").value).toBe("");
  });
});

describe("forgetAllKeptTyped", () => {
  it("clears every kept form on the tab and nothing else", () => {
    window.sessionStorage.setItem(keptTypedKey("gear-add-unit", SCOPE), "{}");
    window.sessionStorage.setItem(keptTypedKey("walk-in-party", "reef.p-2"), "{}");
    window.sessionStorage.setItem("diveday.something-else", "kept");
    forgetAllKeptTyped();
    expect(window.sessionStorage.getItem(keptTypedKey("gear-add-unit", SCOPE))).toBeNull();
    expect(window.sessionStorage.getItem(keptTypedKey("walk-in-party", "reef.p-2"))).toBeNull();
    expect(window.sessionStorage.getItem("diveday.something-else")).toBe("kept");
  });
});
