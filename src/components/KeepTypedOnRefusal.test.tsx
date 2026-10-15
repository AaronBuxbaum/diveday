// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KeepTypedOnRefusal, keptTypedKey } from "./KeepTypedOnRefusal";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function GearForm({ restore }: { restore: boolean }) {
  return (
    <form data-testid="form" onSubmit={(event) => event.preventDefault()}>
      <input name="label" defaultValue="" />
      <input name="serialNumber" defaultValue="" />
      <textarea name="reportedProblem" defaultValue="" />
      <input name="cardNumber" defaultValue="" />
      <KeepTypedOnRefusal form="gear-add-unit" restore={restore} />
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
    expect(window.sessionStorage.getItem(keptTypedKey("gear-add-unit"))).not.toContain("4242");
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
    expect(window.sessionStorage.getItem(keptTypedKey("gear-add-unit"))).not.toBeNull();
    cleanup();
    render(<GearForm restore={false} />);
    expect(window.sessionStorage.getItem(keptTypedKey("gear-add-unit"))).toBeNull();
  });
});
